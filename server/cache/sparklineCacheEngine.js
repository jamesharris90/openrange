const { queryWithTimeout } = require('../db/pg');
const { getCache, setCache, DEFAULT_TTLS } = require('./redisClient');
const { markCacheHit, markCacheMiss } = require('./telemetryCache');
const logger = require('../logger');

const SPARKLINE_KEY_PREFIX = 'openrange:sparkline:';
const SPARKLINE_TOP_KEY = 'openrange:sparkline:top_symbols';

let latestState = {
  status: 'idle',
  updated_at: null,
  rows: 0,
};

async function refreshSparklineCache() {
  const startedAt = Date.now();

  try {
    const { rows: symbols } = await queryWithTimeout(
      `SELECT symbol
       FROM market_quotes
       WHERE symbol IS NOT NULL AND symbol <> ''
       ORDER BY COALESCE(volume, 0) DESC NULLS LAST
       LIMIT 200`,
      [],
      { timeoutMs: 8000, label: 'cache.sparkline.symbols', maxRetries: 0 }
    );

    let cached = 0;
    for (const row of symbols || []) {
      const symbol = String(row.symbol || '').toUpperCase();
      if (!symbol) continue;
      const { rows } = await queryWithTimeout(
        `SELECT EXTRACT(EPOCH FROM timestamp)::bigint AS time, close AS value
         FROM intraday_1m
         WHERE symbol = $1
         ORDER BY timestamp DESC
         LIMIT 60`,
        [symbol],
        { timeoutMs: 2500, label: 'cache.sparkline.points', maxRetries: 0 }
      );

      const points = (rows || []).slice().reverse().map((r) => ({ time: Number(r.time), value: Number(r.value) }));
      await setCache(`${SPARKLINE_KEY_PREFIX}${symbol}`, points, DEFAULT_TTLS.sparkline);
      cached += 1;
    }

    await setCache(SPARKLINE_TOP_KEY, (symbols || []).map((r) => String(r.symbol || '').toUpperCase()).filter(Boolean), DEFAULT_TTLS.sparkline);

    latestState = {
      status: 'ok',
      updated_at: new Date().toISOString(),
      rows: cached,
      execution_time_ms: Date.now() - startedAt,
    };

    return latestState;
  } catch (error) {
    logger.error('[ENGINE ERROR] sparkline cache refresh failed', { error: error.message });
    latestState = {
      status: 'warning',
      updated_at: new Date().toISOString(),
      rows: 0,
      execution_time_ms: Date.now() - startedAt,
      error: error.message,
    };
    return latestState;
  }
}

async function getSparklineFromCache(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return [];

  const cached = await getCache(`${SPARKLINE_KEY_PREFIX}${sym}`);
  if (Array.isArray(cached) && cached.length) {
    await markCacheHit();
    return cached;
  }

  await markCacheMiss();
  return [];
}

async function getSparklineCacheStats() {
  const topSymbols = await getCache(SPARKLINE_TOP_KEY);
  return {
    ...latestState,
    cached_symbols: Array.isArray(topSymbols) ? topSymbols.length : 0,
  };
}

module.exports = {
  refreshSparklineCache,
  getSparklineFromCache,
  getSparklineCacheStats,
};
