const axios = require('axios');

const FMP_BATCH_QUOTE_URL = 'https://financialmodelingprep.com/stable/batch-quote';
const CACHE_TTL_MS = 3_000;

const batchCache = new Map();

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Date.now();
  if (numeric < 10_000_000_000) return numeric * 1000;
  return numeric;
}

function normalizeQuoteRow(row) {
  const price = toNumber(row?.price);
  const open = toNumber(row?.open);
  const high = toNumber(row?.high) ?? toNumber(row?.dayHigh);
  const low = toNumber(row?.low) ?? toNumber(row?.dayLow);
  const close = toNumber(row?.close) ?? price ?? toNumber(row?.previousClose);

  return {
    symbol: String(row?.symbol || '').trim().toUpperCase(),
    price,
    open,
    high,
    low,
    close,
    change: toNumber(row?.change),
    percent: toNumber(row?.changePercentage) ?? toNumber(row?.changesPercentage),
    volume: toNumber(row?.volume),
    avgVolume30d:
      toNumber(row?.avgVolume) ??
      toNumber(row?.avgVolume3m) ??
      toNumber(row?.averageVolume),
    marketCap: toNumber(row?.marketCap),
    timestamp: toTimestamp(row?.timestamp),
  };
}

function getCachedQuotes(cacheKey) {
  const cached = batchCache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.ts > CACHE_TTL_MS) {
    batchCache.delete(cacheKey);
    return null;
  }

  return cached.data;
}

function setCachedQuotes(cacheKey, data) {
  batchCache.set(cacheKey, {
    ts: Date.now(),
    data,
  });
}

function normalizeSymbols(symbols) {
  return String(symbols || '')
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort()
    .join(',');
}

async function fetchBatchQuotes(symbolsString) {
  const normalizedSymbols = normalizeSymbols(symbolsString);
  const cacheKey = normalizedSymbols;
  if (!cacheKey) {
    return [];
  }

  const cached = getCachedQuotes(cacheKey);
  if (cached) return cached;

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('FMP_API_KEY missing');
  }

  const response = await axios.get(FMP_BATCH_QUOTE_URL, {
    params: {
      symbols: normalizedSymbols,
      apikey: apiKey,
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`FMP batch quote failed with status ${response.status}`);
  }

  const rows = Array.isArray(response.data) ? response.data : [];
  const normalized = rows
    .map(normalizeQuoteRow)
    .filter((quote) => quote.symbol.length > 0);

  setCachedQuotes(cacheKey, normalized);
  return normalized;
}

module.exports = {
  fetchBatchQuotes,
};
