const YahooFinance = require('yahoo-finance2').default;

const pool = require('../../pg');
const { fmpFetch } = require('../../services/fmpClient');
const { mapToProviderSymbol, mapFromProviderSymbol, normalizeSymbol } = require('../../utils/symbolMap');
const { getCache, setCache } = require('../cache/memoryCache');

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const INTRADAY_LIMIT = 390;
const DAILY_LIMIT = 260;
const CHART_CACHE_TTL_MS = 2 * 60 * 1000;
const DIRECT_FETCH_CACHE_TTL_MS = 5 * 60 * 1000;

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toUnixTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }

  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.floor(parsed / 1000);
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.historical)) return payload.historical;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.quotes)) return payload.quotes;
  return [];
}

function normalizeCandle(row) {
  const time = toUnixTimestamp(row?.time ?? row?.date ?? row?.datetime ?? row?.timestamp);
  const close = toNumber(row?.close ?? row?.adjClose ?? row?.price, null);
  const open = toNumber(row?.open, close);
  const high = toNumber(row?.high, close);
  const low = toNumber(row?.low, close);
  const volume = Math.max(0, Math.trunc(toNumber(row?.volume, 0) || 0));

  if (!Number.isFinite(time) || !Number.isFinite(close) || close <= 0) {
    return null;
  }

  return {
    time,
    open: Number.isFinite(open) ? open : close,
    high: Number.isFinite(high) ? high : close,
    low: Number.isFinite(low) ? low : close,
    close,
    volume,
  };
}

function dedupeAndSortCandles(rows) {
  const byTime = new Map();
  for (const row of rows || []) {
    const normalized = normalizeCandle(row);
    if (!normalized) continue;
    byTime.set(normalized.time, normalized);
  }

  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

function trimCandles(candles, timeframe) {
  const limit = timeframe === '1m' ? INTRADAY_LIMIT : DAILY_LIMIT;
  return candles.slice(-limit);
}

async function fetchFmpIntraday(symbol) {
  const providerSymbol = mapToProviderSymbol(symbol);
  const payload = await fmpFetch('/historical-chart/1min', { symbol: providerSymbol });
  return trimCandles(dedupeAndSortCandles(asArray(payload)), '1m');
}

async function fetchFmpDaily(symbol) {
  const providerSymbol = mapToProviderSymbol(symbol);
  const payload = await fmpFetch('/historical-price-full', { symbol: providerSymbol });
  return trimCandles(dedupeAndSortCandles(asArray(payload)), 'daily');
}

async function fetchDbIntraday(symbol) {
  const { rows } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM timestamp)::bigint AS time, open, high, low, close, volume
     FROM intraday_1m
     WHERE symbol = $1
     ORDER BY timestamp DESC
     LIMIT $2`,
    [symbol, INTRADAY_LIMIT]
  );

  return dedupeAndSortCandles(rows);
}

async function fetchDbDaily(symbol) {
  const { rows } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM date::timestamp)::bigint AS time, open, high, low, close, volume
     FROM daily_ohlc
     WHERE symbol = $1
     ORDER BY date DESC
     LIMIT $2`,
    [symbol, DAILY_LIMIT]
  );

  return dedupeAndSortCandles(rows);
}

async function fetchYahooDirect(symbol, timeframe) {
  const now = new Date();
  const period1 = timeframe === '1m'
    ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
    : new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const payload = await yahooFinance.chart(symbol, {
    period1,
    period2: now,
    interval: timeframe === '1m' ? '1m' : '1d',
  });

  return trimCandles(dedupeAndSortCandles(asArray(payload)), timeframe);
}

function logChartResult(symbol, payload) {
  console.log('[V2_CHART]', {
    symbol,
    source: payload.source,
    timeframe: payload.timeframe,
    candles: Array.isArray(payload.candles) ? payload.candles.length : 0,
  });
}

async function buildChartPayload(rawSymbol) {
  const symbol = mapFromProviderSymbol(normalizeSymbol(rawSymbol));
  if (!symbol) {
    throw new Error('symbol_required');
  }

  const cacheKey = `v2-chart:${symbol}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return cached;
  }

  const attempts = [
    {
      source: 'fmp',
      timeframe: '1m',
      load: () => fetchFmpIntraday(symbol),
    },
    {
      source: 'fmp',
      timeframe: 'daily',
      load: () => fetchFmpDaily(symbol),
    },
    {
      source: 'db',
      timeframe: '1m',
      load: () => fetchDbIntraday(symbol),
    },
    {
      source: 'db',
      timeframe: 'daily',
      load: () => fetchDbDaily(symbol),
    },
  ];

  for (const attempt of attempts) {
    try {
      const candles = trimCandles(await attempt.load(), attempt.timeframe);
      if (candles.length > 0) {
        const payload = {
          candles,
          timeframe: attempt.timeframe,
          source: attempt.source,
        };
        setCache(cacheKey, payload, CHART_CACHE_TTL_MS);
        logChartResult(symbol, payload);
        return payload;
      }
    } catch (_error) {
    }
  }

  const directCacheKey = `v2-chart-direct:${symbol}`;
  const directCached = getCache(directCacheKey);
  if (directCached) {
    setCache(cacheKey, directCached, CHART_CACHE_TTL_MS);
    logChartResult(symbol, directCached);
    return directCached;
  }

  for (const timeframe of ['1m', 'daily']) {
    try {
      const candles = await fetchYahooDirect(symbol, timeframe);
      if (candles.length > 0) {
        const payload = {
          candles,
          timeframe,
          source: 'fallback',
        };
        setCache(directCacheKey, payload, DIRECT_FETCH_CACHE_TTL_MS);
        setCache(cacheKey, payload, CHART_CACHE_TTL_MS);
        logChartResult(symbol, payload);
        return payload;
      }
    } catch (_error) {
    }
  }

  throw new Error('chart_data_unavailable');
}

module.exports = {
  buildChartPayload,
};