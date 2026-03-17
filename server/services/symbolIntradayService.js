const logger = require('../utils/logger');
const { queryWithTimeout } = require('../db/pg');
const { fmpFetch } = require('./fmpClient');
const { tableExists, promoteSearchSymbol } = require('./trackedUniverseService');

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeIntradayPayload(payload, symbol) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => ({
      symbol,
      timestamp: row.date || row.datetime || row.timestamp || null,
      price: Number(row.close ?? row.price),
      volume: Number(row.volume) || 0,
    }))
    .filter((row) => row.timestamp && Number.isFinite(row.price));
}

async function getCachedSymbolIntraday(symbol) {
  const cacheTableExists = await tableExists('symbol_intraday_cache');
  if (!cacheTableExists) {
    return { rows: [], cacheReady: false };
  }

  const { rows } = await queryWithTimeout(
    `SELECT symbol, timestamp, price, volume, created_at
     FROM symbol_intraday_cache
     WHERE symbol = $1
       AND created_at > NOW() - INTERVAL '15 minutes'
     ORDER BY timestamp DESC`,
    [symbol],
    { timeoutMs: 5000, label: 'symbol_intraday.cache_lookup', maxRetries: 0 }
  );

  return {
    rows: rows || [],
    cacheReady: true,
  };
}

async function writeCacheRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const payload = JSON.stringify(rows);
  await queryWithTimeout(
    `INSERT INTO symbol_intraday_cache (symbol, timestamp, price, volume, created_at)
     SELECT x.symbol, x.timestamp, x.price, x.volume, NOW()
     FROM jsonb_to_recordset($1::jsonb) AS x(symbol text, timestamp timestamp, price numeric, volume numeric)
     ON CONFLICT (symbol, timestamp)
     DO UPDATE SET
       price = EXCLUDED.price,
       volume = EXCLUDED.volume,
       created_at = NOW()`,
    [payload],
    { timeoutMs: 7000, label: 'symbol_intraday.cache_upsert', maxRetries: 0 }
  );

  return rows.length;
}

async function fetchSymbolIntraday(rawSymbol) {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) {
    throw new Error('SYMBOL_REQUIRED');
  }

  const [cacheExists, trackedExists] = await Promise.all([
    tableExists('symbol_intraday_cache'),
    tableExists('tracked_universe'),
  ]);

  if (!cacheExists) {
    throw new Error('symbol_intraday_cache table missing');
  }

  if (!trackedExists) {
    throw new Error('tracked_universe table missing');
  }

  const cached = await getCachedSymbolIntraday(symbol);
  if (cached.rows.length > 0) {
    return {
      symbol,
      source: 'cache',
      rows: cached.rows,
    };
  }

  const payload = await fmpFetch(`/historical-chart/1min/${symbol}`);
  const normalized = normalizeIntradayPayload(payload, symbol);

  if (normalized.length > 0) {
    await writeCacheRows(normalized);
    await promoteSearchSymbol(symbol).catch((error) => {
      logger.warn('search symbol promotion failed', { symbol, error: error.message });
    });
  }

  return {
    symbol,
    source: 'provider',
    rows: normalized,
  };
}

async function getPrimaryIntradayHistory(rawSymbol, limit = 1000) {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) return [];

  const intradayTableExists = await tableExists('intraday_1m');
  if (!intradayTableExists) {
    return [];
  }

  const { rows } = await queryWithTimeout(
    `SELECT symbol, timestamp, open, high, low, close, volume
     FROM intraday_1m
     WHERE symbol = $1
     ORDER BY timestamp DESC
     LIMIT $2`,
    [symbol, Math.max(1, Math.min(Number(limit) || 1000, 5000))],
    { timeoutMs: 6000, label: 'symbol_intraday.primary_lookup', maxRetries: 0 }
  );

  return rows || [];
}

module.exports = {
  fetchSymbolIntraday,
  getPrimaryIntradayHistory,
  getCachedSymbolIntraday,
};
