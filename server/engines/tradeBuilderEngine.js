const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tradeClassFromScore(score) {
  if (score >= 50) return 'A';
  if (score >= 25) return 'B';
  return 'C';
}

function buildWhy(row) {
  if (row.catalyst_type === 'earnings') {
    return 'Earnings catalyst with elevated movement and participation';
  }
  if (row.catalyst_type === 'news') {
    return row.headline || 'News catalyst with follow-through price and volume action';
  }
  return `Price/volume movement: change ${toNumber(row.change_percent).toFixed(2)}%, gap ${toNumber(row.gap_percent).toFixed(2)}%`;
}

async function runTradeBuilderEngine() {
  const startedAt = Date.now();
  const { rows } = await queryWithTimeout(
    `SELECT id, symbol, score, change_percent, gap_percent, relative_volume, catalyst_type, earnings_flag, headline
     FROM opportunity_stream
     WHERE source = 'real'
       AND event_type = 'internal_scanner'
     ORDER BY score DESC
     LIMIT 50`,
    [],
    { timeoutMs: 10000, label: 'engines.tradeBuilderEngine.select_stream', maxRetries: 0 }
  );

  if (!rows.length) {
    throw new Error('trade builder found no internal scanner rows');
  }

  const how = 'Breakout continuation above premarket high with volume confirmation';
  let updated = 0;
  for (const row of rows) {
    const score = toNumber(row.score);
    const changePercent = toNumber(row.change_percent);
    const gapPercent = toNumber(row.gap_percent);
    const relativeVolume = toNumber(row.relative_volume, 1);

    const why = buildWhy(row);
    const confidence = clamp(Math.round(45 + (Math.abs(changePercent) * 3) + (Math.abs(gapPercent) * 2) + (relativeVolume * 4)), 1, 99);
    const expectedMove = Number((Math.abs(gapPercent) + (Math.abs(changePercent) * 0.5)).toFixed(2));
    const tradeClass = tradeClassFromScore(score);

    await queryWithTimeout(
      `UPDATE opportunity_stream
       SET why = $2,
           how = $3,
           confidence = $4,
           expected_move = $5,
           trade_class = $6,
           source = 'real',
           updated_at = NOW()
       WHERE id = $1`,
      [row.id, why, how, confidence, expectedMove, tradeClass],
      { timeoutMs: 5000, label: 'engines.tradeBuilderEngine.update_stream', maxRetries: 0 }
    );
    updated += 1;
  }

  const missing = await queryWithTimeout(
    `SELECT COUNT(*)::int AS missing
     FROM opportunity_stream
     WHERE source = 'real'
       AND event_type = 'internal_scanner'
       AND (COALESCE(why, '') = '' OR COALESCE(how, '') = '')`,
    [],
    { timeoutMs: 7000, label: 'engines.tradeBuilderEngine.validate_fields', maxRetries: 0 }
  );

  const missingCount = Number(missing.rows?.[0]?.missing || 0);
  if (missingCount > 0) {
    throw new Error(`trade builder validation failed; missing WHY/HOW rows: ${missingCount}`);
  }

  const ts = new Date().toISOString();
  logger.info('[TRADE BUILDER]', {
    count: updated,
    timestamp: ts,
    runtimeMs: Date.now() - startedAt,
  });

  return {
    count: updated,
    timestamp: ts,
    runtimeMs: Date.now() - startedAt,
  };
}

module.exports = {
  runTradeBuilderEngine,
};
