const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const { queryWithTimeout } = require('../db/pg');

async function tableExists(tableName) {
  const { rows } = await queryWithTimeout(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = $1
     ) AS exists`,
    [tableName],
    { timeoutMs: 4000, label: `tracked_universe.table_exists.${tableName}`, maxRetries: 0 }
  );
  return Boolean(rows?.[0]?.exists);
}

async function ensureTrackingTables() {
  const [trackedUniverseExists, symbolCacheExists] = await Promise.all([
    tableExists('tracked_universe'),
    tableExists('symbol_intraday_cache'),
  ]);

  return {
    trackedUniverseExists,
    symbolCacheExists,
    ready: trackedUniverseExists && symbolCacheExists,
  };
}

async function getActiveTrackedSymbols() {
  const exists = await tableExists('tracked_universe');
  if (!exists) {
    logger.warn('tracked_universe missing; intraday ingestion skipped');
    return [];
  }

  const { rows } = await queryWithTimeout(
    `SELECT symbol
     FROM tracked_universe
     WHERE active = true
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY priority DESC`,
    [],
    { timeoutMs: 5000, label: 'tracked_universe.active_symbols', maxRetries: 0 }
  );

  return (rows || [])
    .map((row) => String(row.symbol || '').trim().toUpperCase())
    .filter(Boolean);
}

async function promoteCatalystSymbol(symbol) {
  const exists = await tableExists('tracked_universe');
  if (!exists) {
    logger.warn('tracked_universe missing; catalyst promotion skipped', { symbol });
    return false;
  }

  await queryWithTimeout(
    `INSERT INTO tracked_universe(symbol, source, priority, expires_at)
     VALUES($1, 'catalyst', 3, NOW() + INTERVAL '24 hours')
     ON CONFLICT(symbol)
     DO UPDATE SET
       priority = GREATEST(tracked_universe.priority, 3),
       expires_at = NOW() + INTERVAL '24 hours',
       active = true`,
    [symbol],
    { timeoutMs: 5000, label: 'tracked_universe.promote_catalyst', maxRetries: 0 }
  );

  return true;
}

async function promoteNewsSymbol(symbol) {
  const exists = await tableExists('tracked_universe');
  if (!exists) {
    logger.warn('tracked_universe missing; news promotion skipped', { symbol });
    return false;
  }

  await queryWithTimeout(
    `INSERT INTO tracked_universe(symbol, source, priority, expires_at, active, added_at)
     VALUES($1, 'news', 2, NOW() + INTERVAL '12 hours', true, NOW())
     ON CONFLICT(symbol)
     DO UPDATE SET
       priority = GREATEST(COALESCE(tracked_universe.priority, 0), 2),
       expires_at = GREATEST(COALESCE(tracked_universe.expires_at, NOW()), NOW() + INTERVAL '12 hours'),
       active = true`,
    [symbol],
    { timeoutMs: 5000, label: 'tracked_universe.promote_news', maxRetries: 0 }
  );

  return true;
}

async function promoteSearchSymbol(symbol) {
  const exists = await tableExists('tracked_universe');
  if (!exists) {
    logger.warn('tracked_universe missing; search promotion skipped', { symbol });
    return false;
  }

  await queryWithTimeout(
    `INSERT INTO tracked_universe(symbol, source, priority, expires_at, active, added_at)
     VALUES($1, 'search', 2, NOW() + INTERVAL '24 hours', true, NOW())
     ON CONFLICT(symbol)
     DO UPDATE SET
       priority = GREATEST(COALESCE(tracked_universe.priority, 0), 2),
       expires_at = GREATEST(COALESCE(tracked_universe.expires_at, NOW()), NOW() + INTERVAL '24 hours'),
       active = true`,
    [symbol],
    { timeoutMs: 5000, label: 'tracked_universe.promote_search', maxRetries: 0 }
  );

  return true;
}

async function readSymbolsFromFile(fileName) {
  const filePath = path.resolve(__dirname, '../data', fileName);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const payload = JSON.parse(raw);
    const list = Array.isArray(payload) ? payload : (Array.isArray(payload?.symbols) ? payload.symbols : []);
    return list
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

async function getTopUniverseSymbols(limit, exchanges) {
  const exists = await tableExists('ticker_universe');
  if (!exists) return [];

  const { rows } = await queryWithTimeout(
    `SELECT symbol
     FROM ticker_universe
     WHERE is_active = true
       AND exchange = ANY($1)
       AND symbol IS NOT NULL
     ORDER BY market_cap DESC NULLS LAST
     LIMIT $2`,
    [exchanges, limit],
    { timeoutMs: 7000, label: 'tracked_universe.top_universe_symbols', maxRetries: 0 }
  );

  return (rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean);
}

async function getPremarketMovers(limit = 250) {
  const exists = await tableExists('market_metrics');
  if (!exists) return [];

  const { rows } = await queryWithTimeout(
    `SELECT symbol
     FROM market_metrics
     WHERE COALESCE(gap_percent, 0) <> 0
     ORDER BY ABS(COALESCE(gap_percent, 0)) DESC, COALESCE(relative_volume, 0) DESC
     LIMIT $1`,
    [limit],
    { timeoutMs: 6000, label: 'tracked_universe.premarket_movers', maxRetries: 0 }
  );

  return (rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean);
}

async function getRecentCatalystSymbols(limit = 300) {
  const exists = await tableExists('catalyst_events');
  if (!exists) return [];

  const { rows } = await queryWithTimeout(
    `SELECT DISTINCT symbol
     FROM catalyst_events
     WHERE COALESCE(published_at, created_at) >= NOW() - INTERVAL '24 hours'
       AND symbol IS NOT NULL
     LIMIT $1`,
    [limit],
    { timeoutMs: 6000, label: 'tracked_universe.catalyst_symbols', maxRetries: 0 }
  );

  return (rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean);
}

async function getUserWatchlistSymbols(limit = 500) {
  const exists = await tableExists('user_watchlists');
  if (!exists) return [];

  const { rows } = await queryWithTimeout(
    `SELECT DISTINCT symbol
     FROM user_watchlists
     WHERE symbol IS NOT NULL
     LIMIT $1`,
    [limit],
    { timeoutMs: 6000, label: 'tracked_universe.user_watchlists', maxRetries: 0 }
  );

  return (rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean);
}

async function upsertTrackedSymbols(symbols, source, priority, expiresIntervalHours = null) {
  if (!Array.isArray(symbols) || symbols.length === 0) return 0;

  const unique = Array.from(new Set(symbols.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)));
  let affected = 0;

  for (const symbol of unique) {
    if (expiresIntervalHours == null) {
      await queryWithTimeout(
        `INSERT INTO tracked_universe(symbol, source, priority, expires_at, active, added_at)
         VALUES($1, $2, $3, NULL, true, NOW())
         ON CONFLICT(symbol)
         DO UPDATE SET
           priority = GREATEST(COALESCE(tracked_universe.priority, 0), EXCLUDED.priority),
           active = true`,
        [symbol, source, priority],
        { timeoutMs: 5000, label: 'tracked_universe.upsert.no_expiry', maxRetries: 0 }
      );
    } else {
      await queryWithTimeout(
        `INSERT INTO tracked_universe(symbol, source, priority, expires_at, active, added_at)
         VALUES($1, $2, $3, NOW() + ($4::text || ' hours')::interval, true, NOW())
         ON CONFLICT(symbol)
         DO UPDATE SET
           priority = GREATEST(COALESCE(tracked_universe.priority, 0), EXCLUDED.priority),
           expires_at = GREATEST(COALESCE(tracked_universe.expires_at, NOW()), NOW() + ($4::text || ' hours')::interval),
           active = true`,
        [symbol, source, priority, String(expiresIntervalHours)],
        { timeoutMs: 5000, label: 'tracked_universe.upsert.with_expiry', maxRetries: 0 }
      );
    }
    affected += 1;
  }

  return affected;
}

async function buildMorningUniverse() {
  const exists = await tableExists('tracked_universe');
  if (!exists) {
    logger.warn('tracked_universe missing; buildMorningUniverse skipped');
    return { built: false, reason: 'tracked_universe_missing' };
  }

  const [sp500FromFile, nasdaq100FromFile, movers, catalysts, watchlists] = await Promise.all([
    readSymbolsFromFile('sp500_symbols.json'),
    readSymbolsFromFile('nasdaq100_symbols.json'),
    getPremarketMovers(),
    getRecentCatalystSymbols(),
    getUserWatchlistSymbols(),
  ]);

  const [sp500Fallback, nasdaq100Fallback] = await Promise.all([
    sp500FromFile.length ? Promise.resolve([]) : getTopUniverseSymbols(500, ['NYSE', 'NASDAQ']),
    nasdaq100FromFile.length ? Promise.resolve([]) : getTopUniverseSymbols(100, ['NASDAQ']),
  ]);

  const sp500Symbols = sp500FromFile.length ? sp500FromFile : sp500Fallback;
  const nasdaq100Symbols = nasdaq100FromFile.length ? nasdaq100FromFile : nasdaq100Fallback;

  const indexConstituents = Array.from(new Set([...sp500Symbols, ...nasdaq100Symbols]));

  const insertedIndex = await upsertTrackedSymbols(indexConstituents, 'index', 1, null);
  const insertedMovers = await upsertTrackedSymbols(movers, 'mover', 2, 12);
  const insertedCatalysts = await upsertTrackedSymbols(catalysts, 'catalyst', 3, 24);
  const insertedWatchlists = await upsertTrackedSymbols(watchlists, 'watchlist', 3, 48);

  const summary = {
    built: true,
    inserted: {
      indexConstituents: insertedIndex,
      movers: insertedMovers,
      catalysts: insertedCatalysts,
      watchlists: insertedWatchlists,
    },
    sourceSizes: {
      sp500: sp500Symbols.length,
      nasdaq100: nasdaq100Symbols.length,
      movers: movers.length,
      catalysts: catalysts.length,
      watchlists: watchlists.length,
    },
  };

  logger.info('buildMorningUniverse complete', summary);
  return summary;
}

async function cleanupTrackedUniverse() {
  const exists = await tableExists('tracked_universe');
  if (!exists) {
    logger.warn('tracked_universe missing; cleanup skipped');
    return { updated: 0, skipped: true };
  }

  const { rowCount } = await queryWithTimeout(
    `UPDATE tracked_universe
     SET active = false
     WHERE active = true
       AND expires_at IS NOT NULL
       AND expires_at < NOW()`,
    [],
    { timeoutMs: 6000, label: 'tracked_universe.cleanup', maxRetries: 0 }
  );

  return { updated: Number(rowCount || 0), skipped: false };
}

module.exports = {
  tableExists,
  ensureTrackingTables,
  getActiveTrackedSymbols,
  promoteCatalystSymbol,
  promoteNewsSymbol,
  promoteSearchSymbol,
  buildMorningUniverse,
  cleanupTrackedUniverse,
};
