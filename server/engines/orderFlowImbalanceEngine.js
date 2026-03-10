const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function classifyPressure(score) {
  if (score > 10) return 'STRONG';
  if (score >= 6) return 'MODERATE';
  return 'WEAK';
}

async function ensureOrderFlowSignalsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS order_flow_signals (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      price NUMERIC,
      relative_volume NUMERIC,
      float_rotation NUMERIC,
      liquidity_surge NUMERIC,
      pressure_score NUMERIC,
      pressure_level TEXT,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.order_flow.ensure_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_order_flow_symbol_detected
     ON order_flow_signals(symbol, detected_at DESC)`,
    [],
    { timeoutMs: 7000, label: 'engines.order_flow.ensure_index', maxRetries: 0 }
  );
}

async function runOrderFlowImbalanceEngine() {
  const startedAt = Date.now();
  try {
    await ensureOrderFlowSignalsTable();

    const { rows } = await queryWithTimeout(
    `SELECT
       m.symbol,
       COALESCE(q.price, m.price, 0) AS price,
       COALESCE(m.relative_volume, 0) AS relative_volume,
       COALESCE(m.volume, q.volume, 0) AS volume,
       COALESCE(m.avg_volume_30d, 0) AS avg_volume_30d,
       COALESCE(
         NULLIF(m.float_shares, 0),
         CASE
           WHEN COALESCE(q.market_cap, 0) > 0 AND COALESCE(q.price, 0) > 0 THEN (q.market_cap / q.price)
           ELSE 0
         END,
         0
       ) AS float_shares,
       COALESCE(m.change_percent, q.change_percent, 0) AS price_change_percent
     FROM market_metrics m
     LEFT JOIN market_quotes q ON q.symbol = m.symbol
     WHERE m.symbol IS NOT NULL
       AND m.symbol <> ''`,
    [],
    { timeoutMs: 12000, label: 'engines.order_flow.scan', maxRetries: 0 }
  );

    let inserted = 0;
    let scanned = 0;
    const strictCandidates = [];
    const relaxedCandidates = [];

    for (const row of rows) {
    scanned += 1;
    const volume = toNumber(row.volume);
    const avgVolume = toNumber(row.avg_volume_30d);
    const floatShares = toNumber(row.float_shares);
    const rvol = toNumber(row.relative_volume);
    const liquiditySurge = avgVolume > 0 ? (volume / avgVolume) : 0;
    const floatRotation = floatShares > 0 ? (volume / floatShares) : 0;
    const priceChangePercent = Math.abs(toNumber(row.price_change_percent));

    const strictMatch = rvol > 1.5 && liquiditySurge > 4 && floatRotation > 0.5 && priceChangePercent < 2;
    const relaxedMatch = rvol > 1.2 && liquiditySurge > 2 && floatRotation > 0.03 && priceChangePercent < 3;

    if (strictMatch) {
      strictCandidates.push({ row, rvol, liquiditySurge, floatRotation });
      continue;
    }

    if (relaxedMatch) {
      relaxedCandidates.push({ row, rvol, liquiditySurge, floatRotation });
    }
  }

    const candidates = strictCandidates.length
      ? strictCandidates
      : relaxedCandidates
        .sort((a, b) => ((b.rvol * b.liquiditySurge) + b.floatRotation) - ((a.rvol * a.liquiditySurge) + a.floatRotation))
        .slice(0, 25);

    for (const candidate of candidates) {
    const { row, rvol, liquiditySurge, floatRotation } = candidate;

    const pressureScore = (rvol * liquiditySurge) + floatRotation;
    const pressureLevel = classifyPressure(pressureScore);

    const { rowCount } = await queryWithTimeout(
      `INSERT INTO order_flow_signals (
         symbol,
         price,
         relative_volume,
         float_rotation,
         liquidity_surge,
         pressure_score,
         pressure_level,
         detected_at
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, NOW()
       WHERE NOT EXISTS (
         SELECT 1
         FROM order_flow_signals s
         WHERE s.symbol = $1
           AND s.detected_at > NOW() - interval '2 hours'
       )`,
      [
        String(row.symbol || '').toUpperCase(),
        toNumber(row.price),
        rvol,
        floatRotation,
        liquiditySurge,
        pressureScore,
        pressureLevel,
      ],
      { timeoutMs: 7000, label: 'engines.order_flow.insert', maxRetries: 0 }
    );

    if (rowCount > 0) inserted += 1;
  }

    const runtimeMs = Date.now() - startedAt;
    const result = { scanned, inserted, runtimeMs };
    logger.info('[ORDER_FLOW_IMBALANCE] run complete', result);
    return result;
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('[ORDER_FLOW_IMBALANCE] run failed', { error: error.message, runtimeMs });
    return { scanned: 0, inserted: 0, runtimeMs, error: error.message };
  }
}

module.exports = {
  runOrderFlowImbalanceEngine,
  ensureOrderFlowSignalsTable,
};
