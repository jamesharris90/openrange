const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function computeMetrics(row = {}) {
  const volume = toNumber(row.volume);
  const avgVolume30d = toNumber(row.avg_volume_30d);
  const floatShares = toNumber(row.float_shares);
  const relativeVolume = toNumber(row.relative_volume);
  const changePercent = toNumber(row.change_percent);

  const liquiditySurge = avgVolume30d > 0 ? (volume / avgVolume30d) : 0;
  const floatRotation = floatShares > 0 ? (volume / floatShares) : 0;
  const volumeDelta = relativeVolume * changePercent;

  return {
    liquidity_surge: liquiditySurge,
    float_rotation: floatRotation,
    volume_delta: volumeDelta,
  };
}

function detectPressure(metrics = {}, row = {}) {
  const relativeVolume = toNumber(row.relative_volume);
  const changePercent = toNumber(row.change_percent);
  const floatRotationRatio = toNumber(metrics.float_rotation);
  // Treat threshold as percent-of-float while storing ratio for analytics.
  const floatRotationPercent = floatRotationRatio * 100;

  return (
    relativeVolume > 1.5
    && toNumber(metrics.liquidity_surge) > 3
    && floatRotationPercent > 0.3
    && Math.abs(changePercent) < 2
  );
}

function getAccumulationScore(row = {}, metrics = {}) {
  const relativeVolume = toNumber(row.relative_volume);
  return (
    (toNumber(metrics.liquidity_surge) * 40)
    + (toNumber(metrics.float_rotation) * 30)
    + (relativeVolume * 20)
  );
}

function getPressureLevel(score) {
  const value = toNumber(score);
  if (value > 120) return 'extreme';
  if (value > 80) return 'strong';
  if (value > 50) return 'moderate';
  return 'low';
}

async function ensureEarlyAccumulationTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS early_accumulation_signals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      symbol TEXT NOT NULL,
      price NUMERIC,
      volume NUMERIC,
      avg_volume_30d NUMERIC,
      relative_volume NUMERIC,
      float_shares NUMERIC,
      float_rotation NUMERIC,
      liquidity_surge NUMERIC,
      volume_delta NUMERIC,
      accumulation_score NUMERIC,
      pressure_level TEXT,
      sector TEXT,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 8000, label: 'engines.early_accumulation.ensure_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS early_accumulation_symbol_detected_idx
     ON early_accumulation_signals (symbol, detected_at DESC)`,
    [],
    { timeoutMs: 8000, label: 'engines.early_accumulation.ensure_index', maxRetries: 0 }
  );
}

async function runEarlyAccumulationEngine() {
  await ensureEarlyAccumulationTable();

  const { rows } = await queryWithTimeout(
    `SELECT
       m.symbol,
       COALESCE(q.price, m.price, 0) AS price,
       COALESCE(m.volume, q.volume, 0) AS volume,
       COALESCE(m.avg_volume_30d, 0) AS avg_volume_30d,
       COALESCE(m.relative_volume, 0) AS relative_volume,
       COALESCE(
         NULLIF(m.float_shares, 0),
         CASE
           WHEN COALESCE(q.market_cap, 0) > 0 AND COALESCE(q.price, 0) > 0 THEN (q.market_cap / q.price)
           ELSE 0
         END,
         0
       ) AS float_shares,
       COALESCE(m.change_percent, 0) AS change_percent,
       COALESCE(q.sector, 'Unknown') AS sector
     FROM market_metrics m
     LEFT JOIN market_quotes q ON q.symbol = m.symbol
     WHERE m.symbol IS NOT NULL
       AND m.symbol <> ''`,
    [],
    { timeoutMs: 12000, label: 'engines.early_accumulation.scan_market', maxRetries: 0 }
  );

  let scanned = 0;
  let detected = 0;
  let inserted = 0;
  let internalAlerts = 0;

  for (const row of rows) {
    scanned += 1;
    const metrics = computeMetrics(row);
    if (!detectPressure(metrics, row)) continue;

    detected += 1;

    const accumulationScore = getAccumulationScore(row, metrics);
    const pressureLevel = getPressureLevel(accumulationScore);

    const { rowCount } = await queryWithTimeout(
      `INSERT INTO early_accumulation_signals (
         symbol,
         price,
         volume,
         avg_volume_30d,
         relative_volume,
         float_shares,
         float_rotation,
         liquidity_surge,
         volume_delta,
         accumulation_score,
         pressure_level,
         sector,
         detected_at
       )
       SELECT
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
       WHERE NOT EXISTS (
         SELECT 1
         FROM early_accumulation_signals s
         WHERE s.symbol = $1
           AND s.detected_at > NOW() - interval '2 hours'
       )`,
      [
        String(row.symbol || '').toUpperCase(),
        toNumber(row.price),
        toNumber(row.volume),
        toNumber(row.avg_volume_30d),
        toNumber(row.relative_volume),
        toNumber(row.float_shares),
        toNumber(metrics.float_rotation),
        toNumber(metrics.liquidity_surge),
        toNumber(metrics.volume_delta),
        toNumber(accumulationScore),
        pressureLevel,
        row.sector || 'Unknown',
      ],
      { timeoutMs: 8000, label: 'engines.early_accumulation.insert_signal', maxRetries: 0 }
    );

    if (rowCount > 0) {
      inserted += 1;

      if (pressureLevel === 'strong' || pressureLevel === 'extreme') {
        logger.info(
          `[EARLY_ACCUMULATION_ALERT] Early accumulation detected for ${String(row.symbol || '').toUpperCase()}\n`
          + `Liquidity surge ${toNumber(metrics.liquidity_surge).toFixed(2)}\n`
          + `Float rotation ${toNumber(metrics.float_rotation).toFixed(2)}\n`
          + `Score ${toNumber(accumulationScore).toFixed(2)}`
        );
        internalAlerts += 1;
      }
    }
  }

  const result = { scanned, detected, inserted, internalAlerts };
  logger.info('[EARLY_ACCUMULATION] run complete', result);
  return result;
}

module.exports = {
  runEarlyAccumulationEngine,
  ensureEarlyAccumulationTable,
  computeMetrics,
  detectPressure,
  getAccumulationScore,
  getPressureLevel,
};
