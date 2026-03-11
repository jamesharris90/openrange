const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

let latestRefresh = {
  status: 'idle',
  updated_at: null,
  rows: 0,
};

async function ensureSparklineCacheTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS sparkline_cache (
      symbol TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'sparkline_cache.ensure_table', maxRetries: 0 }
  );
}

async function refreshSparklineCache() {
  const startedAt = Date.now();
  try {
    await ensureSparklineCacheTable();

    const { rows } = await queryWithTimeout(
      `WITH active AS (
         SELECT DISTINCT symbol
         FROM market_quotes
         WHERE symbol IS NOT NULL AND symbol <> ''
         ORDER BY symbol
         LIMIT 400
       ),
       spark AS (
         SELECT a.symbol,
                (
                  SELECT jsonb_agg(jsonb_build_object('time', EXTRACT(EPOCH FROM i.timestamp)::bigint, 'value', i.close) ORDER BY i.timestamp)
                  FROM (
                    SELECT timestamp, close
                    FROM intraday_1m
                    WHERE symbol = a.symbol
                    ORDER BY timestamp DESC
                    LIMIT 60
                  ) i
                ) AS points
         FROM active a
       )
       SELECT symbol, COALESCE(points, '[]'::jsonb) AS points
       FROM spark`,
      [],
      { timeoutMs: 20000, label: 'sparkline_cache.refresh.select', maxRetries: 0 }
    );

    let upserts = 0;
    for (const row of rows || []) {
      const result = await queryWithTimeout(
        `INSERT INTO sparkline_cache (symbol, data, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (symbol)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [String(row.symbol || '').toUpperCase(), JSON.stringify(row.points || [])],
        { timeoutMs: 4000, label: 'sparkline_cache.refresh.upsert', maxRetries: 0 }
      );
      upserts += result.rowCount || 0;
    }

    latestRefresh = {
      status: 'ok',
      updated_at: new Date().toISOString(),
      rows: rows.length,
      execution_time_ms: Date.now() - startedAt,
      upserts,
    };

    return latestRefresh;
  } catch (error) {
    logger.error('[ENGINE ERROR]', {
      engine_name: 'sparkline_cache',
      timestamp: new Date().toISOString(),
      message: error.message,
    });
    latestRefresh = {
      status: 'warning',
      updated_at: new Date().toISOString(),
      rows: 0,
      execution_time_ms: Date.now() - startedAt,
      error: error.message,
    };
    return latestRefresh;
  }
}

async function getSparklineFromCache(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return [];
  await ensureSparklineCacheTable();

  const { rows } = await queryWithTimeout(
    `SELECT data
     FROM sparkline_cache
     WHERE symbol = $1
     LIMIT 1`,
    [sym],
    { timeoutMs: 3000, label: 'sparkline_cache.get_symbol', maxRetries: 0 }
  );

  const data = rows?.[0]?.data;
  return Array.isArray(data) ? data : [];
}

async function getSparklineCacheStats() {
  try {
    await ensureSparklineCacheTable();
    const { rows } = await queryWithTimeout(
      `SELECT COUNT(*)::int AS rows, MAX(updated_at) AS updated_at
       FROM sparkline_cache`,
      [],
      { timeoutMs: 3000, label: 'sparkline_cache.stats', maxRetries: 0 }
    );
    return {
      rows: Number(rows?.[0]?.rows || 0),
      updated_at: rows?.[0]?.updated_at || null,
      status: latestRefresh.status,
    };
  } catch {
    return { rows: 0, updated_at: null, status: 'warning' };
  }
}

module.exports = {
  refreshSparklineCache,
  getSparklineFromCache,
  getSparklineCacheStats,
};
