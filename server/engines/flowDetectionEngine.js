const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

async function ensureFlowSignalsTable() {
  try {
    await queryWithTimeout(
      `CREATE TABLE IF NOT EXISTS flow_signals (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        flow_score NUMERIC,
        pressure_level TEXT,
        relative_volume NUMERIC,
        float_rotation NUMERIC,
        liquidity_surge NUMERIC,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      [],
      { timeoutMs: 5000, label: 'engines.flow_detection.ensure_table', maxRetries: 0 }
    );
  } catch (error) {
    logger.error('[ENGINE ERROR] flow_detection ensure table failed', { error: error.message });
  }
}

async function ensureMarketMetricsColumns() {
  try {
    await queryWithTimeout(
      'ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS float_rotation NUMERIC',
      [],
      { timeoutMs: 5000, label: 'engines.flow_detection.ensure_float_rotation', maxRetries: 0 }
    );
    await queryWithTimeout(
      'ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS liquidity_surge NUMERIC',
      [],
      { timeoutMs: 5000, label: 'engines.flow_detection.ensure_liquidity_surge', maxRetries: 0 }
    );
  } catch (error) {
    logger.error('[ENGINE ERROR] flow_detection ensure market_metrics columns failed', { error: error.message });
  }
}

async function runFlowDetectionEngine() {
  const startedAt = Date.now();
  logger.info('[ENGINE_START] flowDetectionEngine');
  try {
    await ensureFlowSignalsTable();
    await ensureMarketMetricsColumns();

    const { rows } = await queryWithTimeout(
      `SELECT
         symbol,
         COALESCE(relative_volume, 0) AS relative_volume,
         COALESCE(float_rotation, 0) AS float_rotation,
         COALESCE(liquidity_surge, 0) AS liquidity_surge,
         CASE
           WHEN COALESCE(relative_volume, 0) >= 4 THEN 'aggressive'
           WHEN COALESCE(relative_volume, 0) >= 2 THEN 'building'
           ELSE 'watch'
         END AS pressure_level
       FROM market_metrics
       WHERE symbol IS NOT NULL
         AND symbol <> ''
         AND (
           COALESCE(relative_volume, 0) >= 2
           OR COALESCE(float_rotation, 0) >= 1.5
           OR COALESCE(liquidity_surge, 0) >= 1.5
         )
       ORDER BY COALESCE(relative_volume, 0) DESC NULLS LAST
       LIMIT 300`,
      [],
      { timeoutMs: 5000, label: 'engines.flow_detection.scan', maxRetries: 0 }
    );

    let inserted = 0;
    for (const row of rows || []) {
      const flowScore = Number((
        (toNum(row.relative_volume) / 10) * 0.50 +
        Math.min(1, toNum(row.float_rotation) / 5) * 0.30 +
        Math.min(1, toNum(row.liquidity_surge) / 5) * 0.20
      ).toFixed(4));

      const result = await queryWithTimeout(
        `INSERT INTO flow_signals (
           symbol,
           flow_score,
           pressure_level,
           relative_volume,
           float_rotation,
           liquidity_surge,
           detected_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          String(row.symbol || '').toUpperCase(),
          flowScore,
          String(row.pressure_level || 'watch'),
          toNum(row.relative_volume),
          toNum(row.float_rotation),
          toNum(row.liquidity_surge),
        ],
        { timeoutMs: 2500, label: 'engines.flow_detection.insert', maxRetries: 0 }
      );
      inserted += result.rowCount || 0;
    }

    logger.info(`[ENGINE_COMPLETE] flowDetectionEngine rows_processed=${inserted}`);

    return {
      ok: true,
      scanned: (rows || []).length,
      inserted,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`[ENGINE_ERROR] flowDetectionEngine error=${error.message}`);
    logger.error('[ENGINE ERROR] flow_detection run failed', { error: error.message });
    return {
      ok: false,
      scanned: 0,
      inserted: 0,
      error: error.message,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
    };
  }
}

async function listLatestFlowSignals(limit = 50) {
  try {
    await ensureFlowSignalsTable();
    const { rows } = await queryWithTimeout(
      `SELECT id, symbol, flow_score, pressure_level, relative_volume, float_rotation, liquidity_surge, detected_at
       FROM flow_signals
       ORDER BY detected_at DESC NULLS LAST
       LIMIT $1`,
      [Math.max(1, Math.min(Number(limit) || 50, 200))],
      { timeoutMs: 3500, label: 'engines.flow_detection.list', maxRetries: 0 }
    );
    return rows || [];
  } catch (error) {
    logger.error('[ENGINE ERROR] flow_detection list failed', { error: error.message });
    return [];
  }
}

module.exports = {
  ensureFlowSignalsTable,
  runFlowDetectionEngine,
  listLatestFlowSignals,
};
