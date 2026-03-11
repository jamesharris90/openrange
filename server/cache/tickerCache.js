const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');
const { getCache, setCache, DEFAULT_TTLS } = require('./redisClient');
const { markCacheHit, markCacheMiss } = require('./telemetryCache');

const REFRESH_MS = 20_000;
const CACHE_KEY = 'openrange:ticker:sections';
let tickerCache = {
  updated_at: null,
  rows: [],
  sections: { indices: [], top_gainers: [], top_losers: [], crypto: [] },
  status: 'idle',
};

async function refreshTickerCache() {
  try {
    const [indices, gainers, losers, crypto] = await Promise.all([
      queryWithTimeout(
        `SELECT symbol, price, change_percent
         FROM market_quotes
         WHERE symbol = ANY($1::text[])
         ORDER BY array_position($1::text[], symbol)`,
        [['SPY', 'QQQ', 'IWM', 'DIA']],
        { timeoutMs: 1800, label: 'ticker_cache.indices', maxRetries: 0 }
      ),
      queryWithTimeout(
        `SELECT symbol, price, change_percent
         FROM market_quotes
         ORDER BY COALESCE(change_percent, 0) DESC NULLS LAST
         LIMIT 20`,
        [],
        { timeoutMs: 1800, label: 'ticker_cache.gainers', maxRetries: 0 }
      ),
      queryWithTimeout(
        `SELECT symbol, price, change_percent
         FROM market_quotes
         ORDER BY COALESCE(change_percent, 0) ASC NULLS LAST
         LIMIT 20`,
        [],
        { timeoutMs: 1800, label: 'ticker_cache.losers', maxRetries: 0 }
      ),
      queryWithTimeout(
        `SELECT symbol, price, change_percent
         FROM market_quotes
         WHERE symbol = ANY($1::text[])
         ORDER BY array_position($1::text[], symbol)`,
        [['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD']],
        { timeoutMs: 1800, label: 'ticker_cache.crypto', maxRetries: 0 }
      ),
    ]);

    const sections = {
      indices: indices.rows || [],
      top_gainers: gainers.rows || [],
      top_losers: losers.rows || [],
      crypto: crypto.rows || [],
    };

    const rows = [
      ...sections.indices,
      ...sections.top_gainers,
      ...sections.top_losers,
      ...sections.crypto,
    ];

    tickerCache = {
      updated_at: new Date().toISOString(),
      rows: rows || [],
      sections,
      status: 'ok',
    };

    await setCache(CACHE_KEY, tickerCache, DEFAULT_TTLS.ticker);
    return tickerCache;
  } catch (error) {
    logger.error('[ENGINE ERROR]', {
      engine_name: 'ticker_cache',
      timestamp: new Date().toISOString(),
      message: error.message,
    });
    tickerCache = {
      ...tickerCache,
      status: 'warning',
      error: error.message,
    };
    return tickerCache;
  }
}

async function getTickerTapeCache() {
  const cached = await getCache(CACHE_KEY);
  if (cached && typeof cached === 'object') {
    await markCacheHit();
    tickerCache = { ...tickerCache, ...cached };
    return tickerCache;
  }

  await markCacheMiss();
  return tickerCache;
}

function startTickerCache() {
  refreshTickerCache();
  setInterval(refreshTickerCache, REFRESH_MS);
}

module.exports = {
  refreshTickerCache,
  getTickerTapeCache,
  startTickerCache,
};
