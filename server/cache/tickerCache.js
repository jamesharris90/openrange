const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

const REFRESH_MS = 30_000;
let tickerCache = {
  updated_at: null,
  rows: [],
  status: 'idle',
};

async function refreshTickerCache() {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol, price, change_percent, volume, sector
       FROM market_quotes
       WHERE symbol IS NOT NULL AND symbol <> ''
       ORDER BY COALESCE(volume, 0) DESC NULLS LAST
       LIMIT 60`,
      [],
      { timeoutMs: 4000, label: 'ticker_cache.refresh', maxRetries: 0 }
    );

    tickerCache = {
      updated_at: new Date().toISOString(),
      rows: rows || [],
      status: 'ok',
    };
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

function getTickerTapeCache() {
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
