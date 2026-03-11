const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

async function ensureSqueezeSignalsTable() {
  try {
    await queryWithTimeout(
      `CREATE TABLE IF NOT EXISTS squeeze_signals (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        short_float NUMERIC,
        relative_volume NUMERIC,
        price_change NUMERIC,
        float_shares NUMERIC,
        score NUMERIC,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      [],
      { timeoutMs: 5000, label: 'engines.short_squeeze.ensure_table', maxRetries: 0 }
    );
  } catch (error) {
    logger.error('[ENGINE ERROR] short_squeeze ensure table failed', { error: error.message });
  }
}

async function ensureMarketMetricsColumns() {
  try {
    await queryWithTimeout(
      'ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS short_float NUMERIC',
      [],
      { timeoutMs: 5000, label: 'engines.short_squeeze.ensure_short_float', maxRetries: 0 }
    );
    await queryWithTimeout(
      'ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS float_shares NUMERIC',
      [],
      { timeoutMs: 5000, label: 'engines.short_squeeze.ensure_float_shares', maxRetries: 0 }
    );
  } catch (error) {
    logger.error('[ENGINE ERROR] short_squeeze ensure market_metrics columns failed', { error: error.message });
  }
}

async function runShortSqueezeEngine() {
  const startedAt = Date.now();
  try {
    await ensureSqueezeSignalsTable();
    await ensureMarketMetricsColumns();

    const { rows } = await queryWithTimeout(
      `SELECT
         symbol,
         COALESCE(short_float, 0) AS short_float,
         COALESCE(relative_volume, 0) AS relative_volume,
         COALESCE(change_percent, 0) AS price_change,
         COALESCE(float_shares, 0) AS float_shares
       FROM market_metrics
       WHERE symbol IS NOT NULL
         AND symbol <> ''
         AND COALESCE(short_float, 0) > 15
         AND COALESCE(relative_volume, 0) > 4
         AND COALESCE(change_percent, 0) > 8
         AND COALESCE(float_shares, 0) > 0
         AND COALESCE(float_shares, 0) < 100000000
       ORDER BY COALESCE(change_percent, 0) DESC NULLS LAST
       LIMIT 200`,
      [],
      { timeoutMs: 5000, label: 'engines.short_squeeze.scan', maxRetries: 0 }
    );

    let inserted = 0;
    for (const row of rows || []) {
      const score = Number((
        (toNum(row.short_float) / 30) * 0.35 +
        (toNum(row.relative_volume) / 10) * 0.30 +
        (toNum(row.price_change) / 20) * 0.25 +
        (1 - Math.min(1, toNum(row.float_shares) / 100000000)) * 0.10
      ).toFixed(4));

      const result = await queryWithTimeout(
        `INSERT INTO squeeze_signals (
           symbol,
           short_float,
           relative_volume,
           price_change,
           float_shares,
           score,
           detected_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          String(row.symbol || '').toUpperCase(),
          toNum(row.short_float),
          toNum(row.relative_volume),
          toNum(row.price_change),
          toNum(row.float_shares),
          score,
        ],
        { timeoutMs: 2500, label: 'engines.short_squeeze.insert', maxRetries: 0 }
      );
      inserted += result.rowCount || 0;
    }

    return {
      ok: true,
      scanned: (rows || []).length,
      inserted,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('[ENGINE ERROR] short_squeeze run failed', { error: error.message });
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

async function listLatestSqueezeSignals(limit = 50) {
  try {
    await ensureSqueezeSignalsTable();
    const { rows } = await queryWithTimeout(
      `SELECT id, symbol, short_float, relative_volume, price_change, float_shares, score, detected_at
       FROM squeeze_signals
       ORDER BY detected_at DESC NULLS LAST
       LIMIT $1`,
      [Math.max(1, Math.min(Number(limit) || 50, 200))],
      { timeoutMs: 3500, label: 'engines.short_squeeze.list', maxRetries: 0 }
    );
    return rows || [];
  } catch (error) {
    logger.error('[ENGINE ERROR] short_squeeze list failed', { error: error.message });
    return [];
  }
}

module.exports = {
  ensureSqueezeSignalsTable,
  runShortSqueezeEngine,
  listLatestSqueezeSignals,
};
