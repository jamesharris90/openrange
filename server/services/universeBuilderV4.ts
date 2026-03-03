// @ts-nocheck
const axios = require('axios');
const path = require('path');
const { getStocksByBuckets } = require(path.join(__dirname, 'directoryServiceV1.ts'));

const BATCH_QUOTE_URL = 'https://financialmodelingprep.com/stable/batch-quote';
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const CHUNK_SIZE = 200;
const CONCURRENCY = 4;

const cacheByKey = new Map();
const cacheTsByKey = new Map();
const inFlightByKey = new Map();
function normalizeBuckets(input) {
  const list = Array.isArray(input) ? input : [];
  const normalized = list
    .map((bucket) => String(bucket || '').trim().toLowerCase())
    .filter((bucket) => ['common', 'etf', 'adr', 'preferred', 'other'].includes(bucket));
  if (!normalized.length) return ['common'];
  return Array.from(new Set(normalized)).sort();
}

function buildCacheKey(buckets) {
  return normalizeBuckets(buckets).join(',');
}


function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPositiveNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(values, size) {
  const parts = [];
  for (let i = 0; i < values.length; i += size) {
    parts.push(values.slice(i, i + size));
  }
  return parts;
}

async function fetchBatchChunk(symbols) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('FMP_API_KEY missing for quote fetch');
  }

  const response = await axios.get(BATCH_QUOTE_URL, {
    params: {
      symbols: symbols.join(','),
      apikey: apiKey,
    },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`batch-quote failed with status ${response.status}`);
  }

  return Array.isArray(response.data) ? response.data : [];
}

async function fetchChunkWithRetry(symbols, chunkIndex) {
  try {
    return await fetchBatchChunk(symbols);
  } catch (firstError) {
    console.warn('[UniverseBuilderV4] chunk failed; retrying once', {
      chunkIndex,
      size: symbols.length,
      message: firstError?.message,
    });
    await delay(300);
    try {
      return await fetchBatchChunk(symbols);
    } catch (secondError) {
      throw new Error(`Quote chunk failed after retry: chunk=${chunkIndex}, error=${secondError?.message}`);
    }
  }
}

async function fetchAllQuotes(symbols) {
  const chunks = chunk(symbols, CHUNK_SIZE);
  const quoteRows = [];
  let pointer = 0;

  async function worker() {
    while (pointer < chunks.length) {
      const currentIndex = pointer;
      pointer += 1;
      const current = chunks[currentIndex];
      const rows = await fetchChunkWithRetry(current, currentIndex);
      quoteRows.push(...rows);
    }
  }

  const workerCount = Math.min(CONCURRENCY, chunks.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return quoteRows;
}

function computeGapPercent(quote) {
  const open = toNumberOrNull(quote?.open);
  const previousClose = toNumberOrNull(quote?.previousClose);
  if (open == null || previousClose == null || previousClose === 0) return null;
  return ((open - previousClose) / previousClose) * 100;
}

function computeRvol(volume, avgVolume) {
  if (volume == null || avgVolume == null || avgVolume <= 0) return null;
  return volume / avgVolume;
}

async function buildUniverse(options = {}) {
  const buckets = normalizeBuckets(options.buckets);
  const stocks = await getStocksByBuckets(buckets);
  const symbols = stocks
    .map((row) => String(row?.symbol || '').trim().toUpperCase())
    .filter(Boolean);

  const quoteRows = await fetchAllQuotes(symbols);
  const quoteMap = new Map();
  quoteRows.forEach((row) => {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (symbol) quoteMap.set(symbol, row);
  });

  if (quoteMap.size < symbols.length) {
    console.log('WARNING: Quote mismatch count', {
      requestedSymbols: symbols.length,
      quoteRows: quoteMap.size,
    });
  }

  const universe = [];

  for (const base of stocks) {
    const symbol = String(base?.symbol || '').trim().toUpperCase();
    const quote = quoteMap.get(symbol) || {};

    const price = toNumberOrNull(quote?.price) ?? toNumberOrNull(base?.price);
    const changePercent = toNumberOrNull(quote?.changePercentage) ?? toNumberOrNull(quote?.changesPercentage);
    const volume = toNumberOrNull(quote?.volume);
    const marketCap = toNumberOrNull(quote?.marketCap) ?? toNumberOrNull(base?.marketCap);
    let avgVolume =
      toPositiveNumberOrNull(quote?.avgVolume) ??
      toPositiveNumberOrNull(quote?.avgVolume3m) ??
      toPositiveNumberOrNull(quote?.averageVolume) ??
      null;

    const gapPercent = computeGapPercent(quote);
    const rvol = computeRvol(volume, avgVolume);

    const high52Week = toNumberOrNull(quote?.yearHigh) ?? toNumberOrNull(base?.high52Week) ?? toNumberOrNull(base?.high52w);
    const low52Week = toNumberOrNull(quote?.yearLow) ?? toNumberOrNull(base?.low52Week) ?? toNumberOrNull(base?.low52w);

    universe.push({
      ...base,
      symbol,
      exchange: base?.exchange || quote?.exchange || base?.exchangeShortName || null,
      name: base?.name || quote?.name || symbol,
      bucket: base?.directoryBucket || null,

      price,
      open: toNumberOrNull(quote?.open) ?? toNumberOrNull(base?.open),
      previousClose: toNumberOrNull(quote?.previousClose) ?? toNumberOrNull(base?.previousClose),
      dayHigh: toNumberOrNull(quote?.dayHigh) ?? toNumberOrNull(quote?.high) ?? toNumberOrNull(base?.dayHigh),
      dayLow: toNumberOrNull(quote?.dayLow) ?? toNumberOrNull(quote?.low) ?? toNumberOrNull(base?.dayLow),
      yearHigh: toNumberOrNull(quote?.yearHigh) ?? toNumberOrNull(base?.yearHigh),
      yearLow: toNumberOrNull(quote?.yearLow) ?? toNumberOrNull(base?.yearLow),
      previousVolume: toNumberOrNull(quote?.previousVolume) ?? toNumberOrNull(base?.previousVolume),

      change: toNumberOrNull(quote?.change) ?? toNumberOrNull(base?.change),
      changesPercentage: toNumberOrNull(quote?.changePercentage) ?? toNumberOrNull(base?.changesPercentage) ?? changePercent,
      changePercent,
      volume,
      marketCap,
      avgVolume,
      gapPercent,
      rvol,
      relativeVolume: toNumberOrNull(base?.relativeVolume) ?? rvol,
      dollarVolume: toNumberOrNull(base?.dollarVolume) ?? (price != null && volume != null ? price * volume : null),
      trades: toNumberOrNull(quote?.trades) ?? toNumberOrNull(base?.trades),

      high52Week,
      low52Week,
      highAllTime: toNumberOrNull(base?.highAllTime) ?? null,
      lowAllTime: toNumberOrNull(base?.lowAllTime) ?? null,
      atr: toNumberOrNull(base?.atr),
      beta: toNumberOrNull(quote?.beta) ?? toNumberOrNull(base?.beta),
      volatility: toNumberOrNull(base?.volatility),

      priceToCash: toNumberOrNull(base?.priceToCash),
      priceToFreeCashFlow: toNumberOrNull(base?.priceToFreeCashFlow),
      evToEbitda: toNumberOrNull(base?.evToEbitda),
      evToSales: toNumberOrNull(base?.evToSales),
    });
  }

  console.log('Universe V4 Count:', universe.length);
  return universe;
}

async function getUniverse(options = {}) {
  const cacheKey = buildCacheKey(options.buckets);
  const now = Date.now();
  const cache = cacheByKey.get(cacheKey);
  const cacheTs = cacheTsByKey.get(cacheKey) || 0;
  if (cache && now - cacheTs < CACHE_TTL_MS) {
    return cache;
  }

  if (inFlightByKey.has(cacheKey)) {
    return inFlightByKey.get(cacheKey);
  }

  const inFlightPromise = (async () => {
    try {
      const built = await buildUniverse({ buckets: cacheKey.split(',') });
      cacheByKey.set(cacheKey, built);
      cacheTsByKey.set(cacheKey, Date.now());
      return built;
    } finally {
      inFlightByKey.delete(cacheKey);
    }
  })();

  inFlightByKey.set(cacheKey, inFlightPromise);

  return inFlightPromise;
}

async function refreshUniverse(options = {}) {
  const cacheKey = buildCacheKey(options.buckets);
  const inFlightPromise = (async () => {
    try {
      const built = await buildUniverse({ buckets: cacheKey.split(',') });
      cacheByKey.set(cacheKey, built);
      cacheTsByKey.set(cacheKey, Date.now());
      return built;
    } finally {
      inFlightByKey.delete(cacheKey);
    }
  })();

  inFlightByKey.set(cacheKey, inFlightPromise);
  return inFlightPromise;
}

module.exports = {
  getUniverse,
  refreshUniverse,
};
