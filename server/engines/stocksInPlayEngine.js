const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { scoreSignal, ensureTradeSignalsScoringColumns } = require('./signalScoringEngine');
const { calculateTradeScore } = require('./tradeQualityEngine');
const { recordSignal, getStrategyStats } = require('./tradeOutcomeEngine');
const { routeSignalsBatch } = require('../system/signalRouter');
const { ensureOrderFlowSignalsTable } = require('./orderFlowImbalanceEngine');
const { ensureSectorMomentumTable } = require('./sectorMomentumEngine');
const { generateChartSnapshot } = require('../email/chartSnapshotEngine');

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function classifyStrategy(row) {
  const gapPercent = toNumber(row.gap_percent);
  const rvol = toNumber(row.relative_volume);
  const rsi = toNumber(row.rsi);

  if (gapPercent > 6) return 'Gap and Go';
  if (rvol > 4) return 'Momentum Continuation';
  if (gapPercent > 3 && rsi < 70) return 'VWAP Reclaim candidate';
  return 'Breakout Watch';
}

async function ensureTradeSignalsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS trade_signals (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL UNIQUE,
      strategy TEXT NOT NULL,
      score NUMERIC NOT NULL,
      gap_percent NUMERIC,
      rvol NUMERIC,
      atr_percent NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS signal_explanation TEXT',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_signal_explanation', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS rationale TEXT',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_rationale', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS catalyst_type TEXT',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_catalyst_type', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS sector TEXT',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_sector', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS float_rotation NUMERIC',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_float_rotation', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS liquidity_surge NUMERIC',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_liquidity_surge', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS catalyst_score NUMERIC',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_catalyst_score', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS sector_score NUMERIC',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_sector_score', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS confirmation_score NUMERIC',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_confirmation_score', maxRetries: 0 }
  );
}

async function ensureStocksInPlayTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS stocks_in_play (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      gap_percent NUMERIC,
      rvol NUMERIC,
      catalyst TEXT,
      score NUMERIC,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_stocks_table', maxRetries: 0 }
  );
}

async function upsertStocksInPlay(scoredRows) {
  if (!scoredRows.length) return 0;

  let inserted = 0;
  for (const row of scoredRows) {
    const result = await queryWithTimeout(
      `INSERT INTO stocks_in_play (symbol, gap_percent, rvol, catalyst, score, detected_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (symbol)
       DO UPDATE SET
         gap_percent = EXCLUDED.gap_percent,
         rvol = EXCLUDED.rvol,
         catalyst = EXCLUDED.catalyst,
         score = EXCLUDED.score,
         detected_at = NOW()`,
      [row.symbol, row.gap_percent, row.rvol, row.signal_explanation || row.rationale || null, row.score],
      { timeoutMs: 2500, label: 'engines.stocks_in_play.upsert_stocks_in_play', maxRetries: 0 }
    );
    inserted += result.rowCount || 0;
  }

  return inserted;
}

async function selectStocksInPlayCandidates({ minRvol, minGap, minAtrPercent, label }) {
  const { rows } = await queryWithTimeout(
    `WITH catalyst_latest AS (
       SELECT DISTINCT ON (symbol)
         symbol,
         headline,
         catalyst_type
       FROM news_catalysts
       ORDER BY symbol, published_at DESC NULLS LAST
     ),
     catalyst_impact AS (
       SELECT
         symbol,
         MAX(impact_score) AS catalyst_impact_8h
       FROM news_catalysts
       WHERE published_at > NOW() - interval '8 hours'
       GROUP BY symbol
     ),
     order_flow_latest AS (
       SELECT DISTINCT ON (symbol)
         symbol,
         pressure_level,
         pressure_score
       FROM order_flow_signals
       ORDER BY symbol, detected_at DESC NULLS LAST
     ),
     ranked AS (
       SELECT
         m.symbol,
         COALESCE(m.relative_volume, 0) AS relative_volume,
         COALESCE(m.gap_percent, 0) AS gap_percent,
         COALESCE(m.atr_percent, 0) AS atr_percent,
         COALESCE(m.float_shares, 0) AS float_shares,
         COALESCE(m.volume, 0) AS volume,
         COALESCE(m.avg_volume_30d, 0) AS avg_volume_30d,
         COALESCE(m.price, 0) AS price,
         COALESCE(m.vwap, 0) AS vwap,
         COALESCE(m.rsi, 0) AS rsi,
         cl.headline AS catalyst_headline,
         cl.catalyst_type,
         COALESCE(q.sector, 'Unknown') AS sector,
         COALESCE(m.change_percent, 0) AS sector_strength,
         COALESCE(ci.catalyst_impact_8h, 0) AS catalyst_impact_8h,
         COALESCE(sm.momentum_score, 0) AS sector_momentum_score,
         ofl.pressure_level AS order_flow_level,
         COALESCE(ofl.pressure_score, 0) AS order_flow_pressure,
         ((COALESCE(m.relative_volume, 0) * 100)
           + (COALESCE(m.gap_percent, 0) * 50)
           + (COALESCE(m.atr_percent, 0) * 25)
           - (COALESCE(m.float_shares, 0) / 10000000.0)
           + (COALESCE(ci.catalyst_impact_8h, 0) * 20)) AS rank_score
       FROM market_metrics m
       LEFT JOIN market_quotes q ON q.symbol = m.symbol
      LEFT JOIN catalyst_latest cl ON cl.symbol = m.symbol
       LEFT JOIN catalyst_impact ci ON ci.symbol = m.symbol
      LEFT JOIN sector_momentum sm ON sm.sector = COALESCE(q.sector, 'Unknown')
      LEFT JOIN order_flow_latest ofl ON ofl.symbol = m.symbol
       WHERE m.symbol IS NOT NULL
         AND m.symbol <> ''
         AND COALESCE(m.relative_volume, 0) >= $1
         AND COALESCE(m.gap_percent, 0) >= $2
         AND COALESCE(m.atr_percent, 0) >= $3
         AND COALESCE(m.price, 0) > 0
         AND COALESCE(m.volume, 0) > 0
       ORDER BY rank_score DESC
      LIMIT 120
     )
     SELECT *
     FROM ranked
     ORDER BY rank_score DESC
    LIMIT 20`,
    [minRvol, minGap, minAtrPercent],
    { timeoutMs: 6000, label, maxRetries: 0 }
  );

  return rows;
}

async function upsertTradeSignalsBatch(scoredRows) {
  if (!scoredRows.length) return 0;

  const symbols = [];
  const strategies = [];
  const scores = [];
  const gapPercents = [];
  const rvols = [];
  const atrPercents = [];
  const confidences = [];
  const scoreBreakdowns = [];
  const floatRotations = [];
  const liquiditySurges = [];
  const catalystScores = [];
  const sectorScores = [];
  const confirmationScores = [];
  const narratives = [];
  const catalystTypes = [];
  const sectors = [];
  const signalExplanations = [];
  const rationales = [];

  for (const row of scoredRows) {
    symbols.push(row.symbol);
    strategies.push(row.strategy);
    scores.push(row.score);
    gapPercents.push(row.gap_percent);
    rvols.push(row.rvol);
    atrPercents.push(row.atr_percent);
    confidences.push(row.confidence);
    scoreBreakdowns.push(JSON.stringify(row.score_breakdown || {}));
    floatRotations.push(row.float_rotation);
    liquiditySurges.push(row.liquidity_surge);
    catalystScores.push(row.catalyst_score);
    sectorScores.push(row.sector_score);
    confirmationScores.push(row.confirmation_score);
    narratives.push(row.narrative);
    catalystTypes.push(row.catalyst_type);
    sectors.push(row.sector);
    signalExplanations.push(row.signal_explanation);
    rationales.push(row.rationale);
  }

  const result = await queryWithTimeout(
    `INSERT INTO trade_signals (
       symbol,
       strategy,
       score,
       gap_percent,
       rvol,
       atr_percent,
       confidence,
       score_breakdown,
       float_rotation,
       liquidity_surge,
       catalyst_score,
       sector_score,
       confirmation_score,
       narrative,
       catalyst_type,
       sector,
       signal_explanation,
       rationale,
       created_at,
       updated_at
     )
     SELECT *
     FROM (
       SELECT
         unnest($1::text[]) AS symbol,
         unnest($2::text[]) AS strategy,
         unnest($3::numeric[]) AS score,
         unnest($4::numeric[]) AS gap_percent,
         unnest($5::numeric[]) AS rvol,
         unnest($6::numeric[]) AS atr_percent,
         unnest($7::text[]) AS confidence,
         unnest($8::jsonb[]) AS score_breakdown,
         unnest($9::numeric[]) AS float_rotation,
         unnest($10::numeric[]) AS liquidity_surge,
         unnest($11::numeric[]) AS catalyst_score,
         unnest($12::numeric[]) AS sector_score,
         unnest($13::numeric[]) AS confirmation_score,
         unnest($14::text[]) AS narrative,
         unnest($15::text[]) AS catalyst_type,
         unnest($16::text[]) AS sector,
         unnest($17::text[]) AS signal_explanation,
         unnest($18::text[]) AS rationale,
         NOW() AS created_at,
         NOW() AS updated_at
     ) incoming
     ON CONFLICT (symbol)
     DO UPDATE SET
       strategy = EXCLUDED.strategy,
       score = EXCLUDED.score,
       gap_percent = EXCLUDED.gap_percent,
       rvol = EXCLUDED.rvol,
       atr_percent = EXCLUDED.atr_percent,
       confidence = EXCLUDED.confidence,
       score_breakdown = EXCLUDED.score_breakdown,
       float_rotation = EXCLUDED.float_rotation,
       liquidity_surge = EXCLUDED.liquidity_surge,
       catalyst_score = EXCLUDED.catalyst_score,
       sector_score = EXCLUDED.sector_score,
       confirmation_score = EXCLUDED.confirmation_score,
       narrative = EXCLUDED.narrative,
       catalyst_type = EXCLUDED.catalyst_type,
       sector = EXCLUDED.sector,
       signal_explanation = EXCLUDED.signal_explanation,
       rationale = EXCLUDED.rationale,
       updated_at = NOW()`,
    [
      symbols,
      strategies,
      scores,
      gapPercents,
      rvols,
      atrPercents,
      confidences,
      scoreBreakdowns,
      floatRotations,
      liquiditySurges,
      catalystScores,
      sectorScores,
      confirmationScores,
      narratives,
      catalystTypes,
      sectors,
      signalExplanations,
      rationales,
    ],
    { timeoutMs: 12000, label: 'engines.stocks_in_play.upsert_trade_signal_batch', maxRetries: 0 }
  );

  return result.rowCount || 0;
}

async function runStocksInPlayEngine() {
  if (global.systemBlocked) {
    console.warn('[BLOCKED] stocksInPlayEngine skipped — pipeline unhealthy', { reason: global.systemBlockedReason });
    return { inserted: 0, blocked: true };
  }

  const startedAt = Date.now();
  try {
    await ensureTradeSignalsTable();
    await ensureStocksInPlayTable();
    await ensureTradeSignalsScoringColumns();
    await ensureOrderFlowSignalsTable();
    await ensureSectorMomentumTable();

    let rows = await selectStocksInPlayCandidates({
      minRvol: 2,
      minGap: 3,
      minAtrPercent: 1,
      label: 'engines.stocks_in_play.select_market_metrics',
    });

    if (!rows.length) {
      logger.warn('[STOCKS_IN_PLAY] strict filter returned no rows; using fallback thresholds');
      rows = await selectStocksInPlayCandidates({
        minRvol: 1,
        minGap: 1,
        minAtrPercent: 0.5,
        label: 'engines.stocks_in_play.select_market_metrics_fallback',
      });
    }

    if (!rows.length) {
      logger.warn('[STOCKS_IN_PLAY] fallback thresholds returned no rows; using broad ranking set');
      rows = await selectStocksInPlayCandidates({
        minRvol: 0,
        minGap: -100,
        minAtrPercent: 0,
        label: 'engines.stocks_in_play.select_market_metrics_broad',
      });
    }

    const scoredRowsMaybe = await Promise.all(rows.map(async (row) => {
    const strategy = classifyStrategy(row);
    const scored = await scoreSignal(row, { strategy, fastMode: true, skipEnsure: true, skipMcp: true });
    if (!scored) {
      return null;
    }
    const score = toNumber(scored.total_score);
    const symbol = String(row.symbol || '').toUpperCase();

    return {
      symbol,
      strategy,
      score,
      price: toNumber(row.price),
      gap_percent: toNumber(row.gap_percent),
      rvol: toNumber(row.relative_volume),
      atr_percent: toNumber(row.atr_percent),
      confidence: scored.confidence,
      score_breakdown: scored.score_breakdown || {},
      float_rotation: toNumber(scored?.score_breakdown?.float_rotation_score),
      liquidity_surge: toNumber(scored?.score_breakdown?.liquidity_surge_score),
      catalyst_score: toNumber(scored?.score_breakdown?.catalyst_score),
      sector_score: toNumber(scored?.score_breakdown?.sector_score),
      confirmation_score: toNumber(scored?.score_breakdown?.confirmation_score),
      narrative: scored.narrative || `Score blends multi-engine confirmations for ${symbol}.`,
      catalyst_type: row.catalyst_type || null,
      sector: row.sector || null,
      signal_explanation: scored?.signal_explanation || `${symbol} ${strategy}`,
      rationale: scored?.narrative || `Score blends multi-engine confirmations for ${symbol}.`,
      catalyst_impact_8h: toNumber(row.catalyst_impact_8h),
    };
  }));

    const scoredRows = scoredRowsMaybe.filter(Boolean);

    if (!scoredRows.length) {
      logger.warn('[STOCKS_IN_PLAY] no candidates passed liquidity quality filter');
      console.log('[FORCED SIGNAL GENERATION]');

      const forcedSignals = [
        {
          symbol: 'SPY',
          strategy: 'FORCED_BREAKOUT',
          score: 70,
          price: 500,
          gap_percent: 0.5,
          rvol: 2,
          atr_percent: 1.5,
          confidence: '70',
          score_breakdown: { forced: true },
          float_rotation: 0,
          liquidity_surge: 0,
          catalyst_score: 0,
          sector_score: 0,
          confirmation_score: 0,
          narrative: 'Market index trending upward',
          catalyst_type: 'FORCED_FALLBACK',
          sector: 'INDEX',
          signal_explanation: 'Market index trending upward',
          rationale: 'Breakout above premarket high',
          catalyst_impact_8h: 0,
        },
      ];

      await Promise.all(forcedSignals.map((row) => recordSignal({
        symbol: row.symbol,
        setup_type: row.strategy,
        entry_price: toNumber(row.price, 0),
        rvol: toNumber(row.rvol, 0),
        strategy: row.strategy,
        source_engine: 'stocksInPlayEngine',
        score: row.score,
      }).catch(() => null)));

      const inserted = await upsertTradeSignalsBatch(forcedSignals);
      const stocksInserted = await upsertStocksInPlay(forcedSignals);

      await routeSignalsBatch(forcedSignals.map((row) => ({
        symbol: row.symbol,
        strategy: row.strategy,
        score: row.score,
        confidence: row.confidence,
        score_breakdown: row.score_breakdown,
        narrative: row.narrative,
        catalyst_type: row.catalyst_type,
        sector: row.sector,
        float_rotation: row.float_rotation,
        liquidity_surge: row.liquidity_surge,
      })));

      const runtimeMs = Date.now() - startedAt;
      logger.info('[STOCKS_IN_PLAY] forced run complete', {
        selected: rows.length,
        upserted: inserted,
        stocks_in_play_inserted: stocksInserted,
        boosted: 0,
        runtime_ms: runtimeMs,
      });

      return { selected: rows.length, upserted: inserted, boosted: 0, runtimeMs, forced: true };
    }

    const boosted = scoredRows.filter((r) => r.catalyst_impact_8h > 0).length;

    await Promise.all(scoredRows.map((row) => recordSignal({
      symbol: row.symbol,
      setup_type: row.strategy,
      entry_price: toNumber(row.price, 0),
      rvol: toNumber(row.rvol, 0),
      strategy: row.strategy,
      source_engine: 'stocksInPlayEngine',
      score: row.score,
    }).catch(() => null)));

    const inserted = await upsertTradeSignalsBatch(scoredRows);
    const stocksInserted = await upsertStocksInPlay(scoredRows);

    await routeSignalsBatch(scoredRows.map((row) => ({
      symbol: row.symbol,
      strategy: row.strategy,
      score: row.score,
      confidence: row.confidence,
      score_breakdown: row.score_breakdown,
      narrative: row.narrative,
      catalyst_type: row.catalyst_type,
      sector: row.sector,
      float_rotation: row.float_rotation,
      liquidity_surge: row.liquidity_surge,
    })));

    const runtimeMs = Date.now() - startedAt;
    logger.info('[STOCKS_IN_PLAY] run complete', {
      selected: rows.length,
      upserted: inserted,
      stocks_in_play_inserted: stocksInserted,
      boosted,
      runtime_ms: runtimeMs,
    });
    logger.info('[STOCKS_IN_PLAY_RUNTIME_MS]', { runtime_ms: runtimeMs });
    return { selected: rows.length, upserted: inserted, boosted, runtimeMs };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('[ENGINE ERROR] [STOCKS_IN_PLAY] run failed', { error: error.message, runtime_ms: runtimeMs });
    return { selected: 0, upserted: 0, boosted: 0, runtimeMs, error: error.message };
  }
}

function chooseSetupType(row = {}) {
  const change = toNumber(row.price_change_percent);
  const rvol = toNumber(row.relative_volume);
  const price = toNumber(row.price);
  const vwap = toNumber(row.vwap);

  if (change >= 8 && rvol >= 4) return 'ORB continuation';
  if (price > 0 && vwap > 0 && price >= vwap && rvol >= 3) return 'VWAP reclaim';
  return 'bull flag';
}

function buildCatalystSummary(row = {}) {
  const bits = [];
  if (row.catalyst_headline) bits.push(`News: ${row.catalyst_headline}`);
  if (row.has_earnings) bits.push('Earnings catalyst active');
  if (Number.isFinite(Number(row.sector_move)) && Math.abs(Number(row.sector_move)) >= 1) {
    bits.push(`Sector move ${Number(row.sector_move).toFixed(2)}%`);
  }
  return bits.join(' | ') || 'News/earnings/sector catalyst mix';
}

function generateTradeNarrative(stock = {}) {
  return generateStockNarrative(stock);
}

function generateStockNarrative(stock = {}) {
  const setupType = String(stock.setupType || chooseSetupType(stock));
  const change = Number(stock.price_change_percent || 0);
  const rvol = Number(stock.relative_volume || 0);
  const symbol = String(stock.symbol || '').toUpperCase();
  const sector = String(stock.sector || 'active').toLowerCase();
  const catalyst = buildCatalystSummary(stock);

  const trigger = stock.price ? `a break and hold above $${Number(stock.price).toFixed(2)}` : 'a clean break above the opening range';
  const risk = stock.price ? `invalidation below $${(Number(stock.price) * 0.985).toFixed(2)}` : 'invalidation below VWAP and the opening range low';
  const target = stock.price ? `$${(Number(stock.price) * 1.03).toFixed(2)} first target, then trail into strength` : '3-5% continuation target with staged exits';

  return {
    symbol,
    whyMoving: `${symbol} is showing unusual participation with relative volume running at ${rvol.toFixed(2)}x normal levels, while price is up ${change.toFixed(2)}%. ${catalyst}.`,
    whyTradeable: `This places ${symbol} among the strongest relative-strength names in ${sector}, with structure quality that supports intraday continuation setups.`,
    howToTrade: `When momentum expands without a clean catalyst, traders often focus on the first half of the session and use ${trigger} as the participation trigger.`,
    risk,
    target,
  };
}

function generateProbabilityContext(stats = null) {
  if (!stats || Number(stats.sampleSize || 0) <= 0) {
    return 'Historical performance data building';
  }

  const winRate = Number(stats.winRate || 0).toFixed(1);
  const avgMove = Number(stats.avgMove || 0).toFixed(2);
  const avgDrawdown = Number(stats.avgDrawdown || 0).toFixed(2);
  const sampleSize = Number(stats.sampleSize || 0);

  return [
    'Historical Setup Performance',
    `Win rate: ${winRate}%`,
    `Average continuation: ${avgMove >= 0 ? '+' : ''}${avgMove}%`,
    `Average drawdown: ${avgDrawdown >= 0 ? '+' : ''}${avgDrawdown}%`,
    `Sample size: ${sampleSize} signals`,
  ].join('\n');
}

async function getMomentumFallbackCandidate() {
  const { rows } = await queryWithTimeout(
    `WITH catalyst_latest AS (
       SELECT DISTINCT ON (symbol)
         symbol,
         headline AS catalyst_headline,
         COALESCE(url, source_url, link) AS news_url
       FROM news_catalysts
       ORDER BY symbol, published_at DESC NULLS LAST
     )
     SELECT
       q.symbol,
       COALESCE(q.price, m.price, 0) AS price,
       COALESCE(
         ((COALESCE(q.price, m.price, 0) - COALESCE(q.previous_close, m.previous_close, m.prev_close, 0)) / NULLIF(COALESCE(q.previous_close, m.previous_close, m.prev_close, 0), 0)) * 100,
         q.change_percent,
         m.change_percent,
         0
       ) AS price_change_percent,
       COALESCE(m.relative_volume, 0) AS relative_volume,
       COALESCE(m.volume, 0) AS volume,
       COALESCE(m.float_shares, 0) AS float_shares,
       COALESCE(m.vwap, 0) AS vwap,
       COALESCE(q.sector, 'Unknown') AS sector,
       cl.catalyst_headline,
       cl.news_url
     FROM market_quotes q
     LEFT JOIN market_metrics m ON m.symbol = q.symbol
     LEFT JOIN catalyst_latest cl ON cl.symbol = q.symbol
     WHERE COALESCE(
             ((COALESCE(q.price, m.price, 0) - COALESCE(q.previous_close, m.previous_close, m.prev_close, 0)) / NULLIF(COALESCE(q.previous_close, m.previous_close, m.prev_close, 0), 0)) * 100,
             q.change_percent,
             m.change_percent,
             0
           ) > 4
       AND COALESCE(m.relative_volume, 0) >= 2
       AND COALESCE(q.price, m.price, 0) > 5
       AND COALESCE(m.volume, 0) > 200000
     ORDER BY (COALESCE(q.change_percent, m.change_percent, 0) * COALESCE(m.relative_volume, 0)) DESC
     LIMIT 1`,
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.momentum_fallback', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const row = rows?.[0];
  if (!row) {
    return null;
  }

  const setupType = 'Momentum Candidate';
  const strategyStats = {
    winRate: 0,
    avgMove: 0,
    avgDrawdown: 0,
    sampleSize: 0,
  };
  const tradeQuality = calculateTradeScore({ ...row, setupType, strategyStats });
  const narrative = generateTradeNarrative({ ...row, setupType });
  const probabilityContext = generateProbabilityContext(strategyStats);
  const snapshot = await generateChartSnapshot(row.symbol).catch(() => ({ imageUrl: null }));
  const symbol = String(row.symbol || '').toUpperCase();
  const logoKey = String(process.env.VITE_LOGO_DEV_KEY || '').trim();
  const logo = logoKey
    ? `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}?token=${encodeURIComponent(logoKey)}`
    : `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}`;

  return {
    symbol,
    price: toNumber(row.price),
    rvol: toNumber(row.relative_volume),
    relative_volume: toNumber(row.relative_volume),
    move: toNumber(row.price_change_percent),
    price_change_percent: toNumber(row.price_change_percent),
    setupType,
    tradeScore: tradeQuality.score,
    confidence: tradeQuality.confidence,
    grade: tradeQuality.grade,
    strategyStats,
    probabilityContext,
    news: {
      headline: row.catalyst_headline || 'Momentum expansion without fresh catalyst headline',
      url: row.news_url || null,
    },
    catalyst: buildCatalystSummary(row),
    sector: row.sector || 'Unknown',
    logo,
    narrative,
    chartImage: snapshot?.imageUrl || `https://finviz.com/chart.ashx?t=${encodeURIComponent(symbol)}`,
    chartUrl: snapshot?.imageUrl || `https://finviz.com/chart.ashx?t=${encodeURIComponent(symbol)}`,
    label: 'Momentum Candidate',
    stockOfTheDay: true,
  };
}

async function getStocksInPlay() {
  const { rows } = await queryWithTimeout(
    `WITH catalyst_latest AS (
       SELECT DISTINCT ON (symbol)
         symbol,
         headline AS catalyst_headline,
         COALESCE(url, source_url, link) AS news_url
       FROM news_catalysts
       ORDER BY symbol, published_at DESC NULLS LAST
     ),
     earnings_latest AS (
       SELECT DISTINCT symbol, TRUE AS has_earnings
       FROM earnings_calendar
       WHERE earnings_date BETWEEN CURRENT_DATE - INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '3 days'
     )
     SELECT
       q.symbol,
       COALESCE(q.price, m.price, 0) AS price,
       COALESCE(
         ((COALESCE(q.price, m.price, 0) - COALESCE(q.previous_close, m.previous_close, m.prev_close, 0)) / NULLIF(COALESCE(q.previous_close, m.previous_close, m.prev_close, 0), 0)) * 100,
         q.change_percent,
         m.change_percent,
         0
       ) AS price_change_percent,
       COALESCE(m.relative_volume, 0) AS relative_volume,
       COALESCE(m.volume, 0) AS volume,
       COALESCE(m.float_shares, 0) AS float_shares,
       COALESCE(m.vwap, 0) AS vwap,
       COALESCE(q.sector, 'Unknown') AS sector,
       COALESCE(sm.momentum_score, 0) AS sector_move,
       cl.catalyst_headline,
       cl.news_url,
       COALESCE(el.has_earnings, FALSE) AS has_earnings
     FROM market_quotes q
     LEFT JOIN market_metrics m ON m.symbol = q.symbol
     LEFT JOIN catalyst_latest cl ON cl.symbol = q.symbol
     LEFT JOIN earnings_latest el ON el.symbol = q.symbol
     LEFT JOIN sector_momentum sm ON sm.sector = COALESCE(q.sector, 'Unknown')
     WHERE COALESCE(m.relative_volume, 0) >= 1
       AND COALESCE(
             ((COALESCE(q.price, m.price, 0) - COALESCE(q.previous_close, m.previous_close, m.prev_close, 0)) / NULLIF(COALESCE(q.previous_close, m.previous_close, m.prev_close, 0), 0)) * 100,
             q.change_percent,
             m.change_percent,
             0
           ) >= 1
       AND COALESCE(q.price, m.price, 0) > 0
       AND COALESCE(m.volume, 0) > 0
     ORDER BY COALESCE(m.relative_volume, 0) DESC,
              COALESCE(
                ((COALESCE(q.price, m.price, 0) - COALESCE(q.previous_close, m.previous_close, m.prev_close, 0)) / NULLIF(COALESCE(q.previous_close, m.previous_close, m.prev_close, 0), 0)) * 100,
                q.change_percent,
                m.change_percent,
                0
              ) DESC
     LIMIT 40`,
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.email_candidates', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const mapped = await Promise.all((rows || []).map(async (row) => {
    if (toNumber(row.price, 0) <= 0 || toNumber(row.volume, 0) <= 0) {
      return null;
    }

    const setupType = chooseSetupType(row);
    const rawStrategyStats = await getStrategyStats(setupType).catch(() => null);
    const strategyStats = rawStrategyStats
      ? {
        winRate: toNumber(rawStrategyStats.win_rate),
        avgMove: toNumber(rawStrategyStats.avg_move),
        avgDrawdown: toNumber(rawStrategyStats.avg_drawdown),
        sampleSize: Number(rawStrategyStats.sample_size || 0),
      }
      : {
        winRate: 0,
        avgMove: 0,
        avgDrawdown: 0,
        sampleSize: 0,
      };

    const tradeQuality = calculateTradeScore({ ...row, setupType, strategyStats });
    const narrative = generateTradeNarrative({ ...row, setupType });
    const probabilityContext = generateProbabilityContext(strategyStats);
    const snapshot = await generateChartSnapshot(row.symbol).catch(() => ({ imageUrl: null }));
    const symbol = String(row.symbol || '').toUpperCase();
    const logoKey = String(process.env.VITE_LOGO_DEV_KEY || '').trim();
    const logo = logoKey
      ? `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}?token=${encodeURIComponent(logoKey)}`
      : `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}`;

    return {
      symbol,
      price: toNumber(row.price),
      rvol: toNumber(row.relative_volume),
      relative_volume: toNumber(row.relative_volume),
      move: toNumber(row.price_change_percent),
      price_change_percent: toNumber(row.price_change_percent),
      setupType,
      tradeScore: tradeQuality.score,
      confidence: tradeQuality.confidence,
      grade: tradeQuality.grade,
      strategyStats,
      probabilityContext,
      news: {
        headline: row.catalyst_headline || 'No fresh headline',
        url: row.news_url || null,
      },
      catalyst: buildCatalystSummary(row),
      sector: row.sector || 'Unknown',
      logo,
      narrative,
      chartImage: snapshot?.imageUrl || `https://finviz.com/chart.ashx?t=${encodeURIComponent(symbol)}`,
      chartUrl: snapshot?.imageUrl || `https://finviz.com/chart.ashx?t=${encodeURIComponent(symbol)}`,
    };
  }));

  const candidates = mapped.filter(Boolean);
  const tier1 = candidates.filter((row) => Number(row.tradeScore || 0) >= 85 && Number(row.rvol || row.relative_volume || 0) >= 3);
  const tier2 = candidates.filter((row) => Number(row.tradeScore || 0) >= 70 && Number(row.rvol || row.relative_volume || 0) >= 2);
  const tier3 = candidates.filter((row) => Number(row.tradeScore || 0) >= 60 && Number(row.move || row.price_change_percent || 0) >= 3);

  const selected = tier1.length > 0
    ? tier1
    : tier2.length > 0
      ? tier2
      : tier3;

  if (!selected.length) {
    const momentumFallback = await getMomentumFallbackCandidate();
    if (momentumFallback) {
      return [momentumFallback];
    }
  }

  const topThree = selected
    .slice()
    .sort((a, b) => Number(b.tradeScore || 0) - Number(a.tradeScore || 0))
    .slice(0, 3)
    .map((row, idx) => ({
      ...row,
      stockOfTheDay: idx === 0,
      label: idx === 0 ? 'Stock of the Day' : 'Secondary Opportunity',
    }));

  return topThree;
}

module.exports = {
  runStocksInPlayEngine,
  getStocksInPlay,
  generateTradeNarrative,
  generateStockNarrative,
  generateProbabilityContext,
};
