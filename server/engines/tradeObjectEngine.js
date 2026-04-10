const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { loadAndValidateTruth } = require('./_truthGuard');

function asNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createWhy(row) {
  if (row.headline) return row.headline;
  if (row.earnings_flag) return 'Upcoming or recent earnings catalyst with tradable momentum';
  return `Momentum and participation: ${Number(row.change_percent).toFixed(2)}% move with relative volume ${Number(row.relative_volume).toFixed(2)}x`;
}

function createStrategy(row) {
  if (row.catalyst_type === 'NEWS') return 'Catalyst Momentum Breakout';
  if (row.catalyst_type === 'EARNINGS') return 'Post-Earnings Continuation';
  return 'Technical Momentum Continuation';
}

function normalizeScores(rows) {
  const scores = rows.map((r) => Number(r.score)).filter((n) => Number.isFinite(n));
  const min = scores.length ? Math.min(...scores) : 0;
  const max = scores.length ? Math.max(...scores) : 1;
  const spread = max - min;
  return { min, max, spread: spread === 0 ? 1 : spread };
}

function tradeClassFromChange(changePercent) {
  const absChange = Math.abs(Number(changePercent));
  if (absChange < 3) return 'EARLY';
  if (absChange <= 6) return 'CONFIRMING';
  return 'EXTENDED';
}

async function runTradeObjectEngine() {
  const startedAt = Date.now();

  loadAndValidateTruth({
    requiredTables: {
      opportunity_stream: ['id', 'symbol', 'event_type', 'headline', 'score', 'source', 'change_percent', 'gap_percent', 'relative_volume', 'confidence', 'expected_move', 'trade_class', 'why', 'how', 'catalyst_type', 'earnings_flag', 'updated_at'],
      market_metrics: ['symbol', 'price', 'volume', 'atr', 'source'],
      trade_setups: ['symbol', 'setup', 'grade', 'score', 'gap_percent', 'relative_volume', 'atr', 'detected_at', 'setup_type', 'updated_at', 'entry_price', 'created_at'],
    },
    requiredMappings: ['batch-quote', 'batch-exchange-quote'],
  });

  const { rows } = await queryWithTimeout(
    `WITH top_signals AS (
       SELECT
         id,
         symbol,
         headline,
         score,
         change_percent,
         gap_percent,
         relative_volume,
         catalyst_type,
         earnings_flag
       FROM opportunity_stream
       WHERE source = 'real'
         AND event_type = 'signal_quality_engine'
       ORDER BY score DESC
       LIMIT 20
     )
     SELECT
       ts.id,
       ts.symbol,
       ts.headline,
       ts.score,
       ts.change_percent,
       ts.gap_percent,
       ts.relative_volume,
       ts.catalyst_type,
       ts.earnings_flag,
       mm.price,
       mm.volume,
       mm.atr
     FROM top_signals ts
     JOIN market_metrics mm
       ON mm.symbol = ts.symbol
      AND mm.source = 'real'
     ORDER BY ts.score DESC`,
    [],
    { timeoutMs: 30000, label: 'engines.tradeObjectEngine.select_signals', maxRetries: 1 }
  );

  if (!rows.length) {
    throw new Error('trade object engine found no signal rows');
  }

  const { min, spread } = normalizeScores(rows);
  let upserted = 0;

  for (const row of rows) {
    const symbol = String(row.symbol || '').trim().toUpperCase();
    const price = asNumber(row.price);
    const changePercent = asNumber(row.change_percent);
    const volume = asNumber(row.volume, 0);
    const gapPercent = asNumber(row.gap_percent, 0);
    const relativeVolume = asNumber(row.relative_volume, 1);
    const atr = asNumber(row.atr);
    const rawScore = asNumber(row.score, 0);

    if (!symbol || price === null || changePercent === null) {
      continue;
    }

    const strategy = createStrategy(row);
    const why = createWhy({ ...row, relative_volume: relativeVolume });
    const how = 'Breakout continuation above key level with volume confirmation';

    const normalized = ((rawScore - min) / spread) * 100;
    let confidence = normalized;
    if (row.catalyst_type) confidence += 10;
    if (volume < 300000) confidence -= 10;
    confidence = clamp(confidence, 0, 100);

    const expectedMove = atr && atr > 0 ? atr : Math.abs(changePercent) * 1.5;
    const tradeClass = tradeClassFromChange(changePercent);

    if (!why || !how) {
      throw new Error(`trade object gate failed for ${symbol}; WHY/HOW missing`);
    }
    if (!Number.isFinite(confidence)) {
      throw new Error(`trade object gate failed for ${symbol}; confidence NaN`);
    }
    if (!Number.isFinite(expectedMove) || expectedMove === 0) {
      throw new Error(`trade object gate failed for ${symbol}; expected_move invalid`);
    }

    await queryWithTimeout(
      `UPDATE opportunity_stream
       SET why = $2,
           how = $3,
           confidence = $4,
           expected_move = $5,
           trade_class = $6,
           updated_at = NOW()
       WHERE id = $1`,
      [row.id, why, how, confidence, expectedMove, tradeClass],
      { timeoutMs: 6000, label: 'engines.tradeObjectEngine.update_stream_object', maxRetries: 0 }
    );

    const tradeObject = {
      symbol,
      price,
      change_percent: changePercent,
      volume,
      strategy,
      confidence,
      expected_move: expectedMove,
      why,
      how,
      trade_class: tradeClass,
      session: 'PENDING',
      source: 'real',
    };

    await queryWithTimeout(
      `INSERT INTO trade_setups (
        symbol,
        setup,
        grade,
        score,
        gap_percent,
        relative_volume,
        atr,
        detected_at,
        setup_type,
        updated_at,
        entry_price,
        created_at
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        NOW(),
        $8,
        NOW(),
        $9,
        NOW()
      )
      ON CONFLICT (symbol)
      DO UPDATE SET
        setup = EXCLUDED.setup,
        grade = EXCLUDED.grade,
        score = EXCLUDED.score,
        gap_percent = EXCLUDED.gap_percent,
        relative_volume = EXCLUDED.relative_volume,
        atr = EXCLUDED.atr,
        detected_at = NOW(),
        setup_type = EXCLUDED.setup_type,
        updated_at = NOW(),
        entry_price = EXCLUDED.entry_price`,
      [
        symbol,
        JSON.stringify(tradeObject),
        tradeClass,
        confidence,
        gapPercent,
        relativeVolume,
        atr,
        strategy,
        price,
      ],
      { timeoutMs: 7000, label: 'engines.tradeObjectEngine.upsert_trade_setup', maxRetries: 0 }
    );

    upserted += 1;
  }

  if (upserted < 5) {
    throw new Error(`trade object gate failed; upserted=${upserted}`);
  }

  logger.info('[TRADE OBJECT ENGINE]', {
    count: upserted,
    runtimeMs: Date.now() - startedAt,
  });

  return {
    count: upserted,
    runtimeMs: Date.now() - startedAt,
  };
}

module.exports = {
  runTradeObjectEngine,
};
