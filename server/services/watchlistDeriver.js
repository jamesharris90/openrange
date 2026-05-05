const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = {
  expiresAt: 0,
  symbols: [],
  updatedAt: null,
};

async function getCurrentWatchlistSymbols() {
  if (cache.expiresAt > Date.now()) {
    return new Set(cache.symbols);
  }

  try {
    const result = await queryWithTimeout(
      `
        SELECT DISTINCT symbol
        FROM beacon_v0_picks
        WHERE symbol IS NOT NULL
          AND (created_at AT TIME ZONE 'America/New_York')::date >= ((NOW() AT TIME ZONE 'America/New_York')::date - 5)
        ORDER BY symbol ASC
      `,
      [],
      {
        label: 'calendar.watchlist.current',
        timeoutMs: 8000,
        maxRetries: 1,
        poolType: 'read',
      },
    );

    const symbols = result.rows
      .map((row) => String(row.symbol || '').trim().toUpperCase())
      .filter(Boolean);

    cache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      symbols,
      updatedAt: new Date().toISOString(),
    };

    return new Set(symbols);
  } catch (error) {
    logger.error('failed to derive current watchlist symbols', { error: error.message });
    throw error;
  }
}

function getWatchlistCacheUpdatedAt() {
  return cache.updatedAt;
}

module.exports = {
  getCurrentWatchlistSymbols,
  getWatchlistCacheUpdatedAt,
};