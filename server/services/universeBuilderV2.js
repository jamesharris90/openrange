const axios = require('axios');

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable/company-screener';
const EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX'];
const REQUEST_LIMIT = 1000;
const TIMEOUT_MS = 30000;
const MAX_DEPTH = 10;
const MIN_SPAN = 5_000_000;
const DEFAULT_MIN_CAP = 0;
const DEFAULT_MAX_CAP = 10_000_000_000_000;
const MAX_RETRIES = 5;
const CACHE_TTL_MS = 5 * 60 * 1000;

let universeCache = null;
let lastBuildTime = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeExchange(row) {
  return String(row?.exchangeShortName || row?.exchange || '').trim().toUpperCase();
}

function isIncludedStock(row) {
  const exchange = normalizeExchange(row);
  const type = String(row?.type || 'stock').trim().toLowerCase();
  const symbol = String(row?.symbol || '').trim().toUpperCase();
  const companyName = String(row?.companyName || row?.name || '').toLowerCase();

  if (!symbol) return false;
  if (!EXCHANGES.includes(exchange)) return false;
  if (type !== 'stock') return false;

  const looksLikeExcludedName =
    companyName.includes(' etf') ||
    companyName.includes('exchange traded fund') ||
    companyName.includes(' fund') ||
    companyName.includes('warrant') ||
    companyName.includes(' units') ||
    companyName.includes(' unit ');

  const looksLikeExcludedSymbol =
    symbol.endsWith('W') ||
    symbol.endsWith('WRT') ||
    symbol.endsWith('U') ||
    symbol.includes('-W') ||
    symbol.includes('.W') ||
    symbol.includes('-U') ||
    symbol.includes('.U');

  if (looksLikeExcludedName || looksLikeExcludedSymbol) return false;

  return true;
}

function mapRow(row) {
  return {
    symbol: String(row?.symbol || '').trim().toUpperCase(),
    companyName: String(row?.companyName || row?.name || '').trim(),
    exchange: normalizeExchange(row),
    marketCap: Number.isFinite(Number(row?.marketCap)) ? Number(row.marketCap) : null,
    price: Number.isFinite(Number(row?.price)) ? Number(row.price) : null,
    volume: Number.isFinite(Number(row?.volume)) ? Number(row.volume) : null,
  };
}

async function fetchCompanyScreener(params) {
  const apiKey = process.env.FMP_API_KEY || '';
  const requestParams = {
    ...params,
    isActivelyTrading: 'true',
    isEtf: 'false',
    isFund: 'false',
    limit: String(REQUEST_LIMIT),
    apikey: apiKey,
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await axios.get(FMP_BASE_URL, {
        params: requestParams,
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
      });

      if (response.status === 429) {
        const backoff = Math.min(1000 * 2 ** attempt, 30000);
        await sleep(backoff);
        continue;
      }

      if (response.status >= 200 && response.status < 300) {
        return Array.isArray(response.data) ? response.data : [];
      }

      console.warn('[universeBuilderV2] non-200 response', {
        status: response.status,
        exchange: params.exchange,
        marketCapMoreThan: params.marketCapMoreThan,
        marketCapLowerThan: params.marketCapLowerThan,
      });
      return [];
    } catch (error) {
      const isTimeout = error?.code === 'ECONNABORTED';
      const isNetwork = Boolean(error?.request) && !error?.response;
      if (isTimeout || isNetwork) {
        console.warn('[universeBuilderV2] transient request error', {
          exchange: params.exchange,
          message: error?.message,
          timeout: isTimeout,
          attempt: attempt + 1,
        });
        const backoff = Math.min(1000 * 2 ** attempt, 30000);
        await sleep(backoff);
        continue;
      }

      console.warn('[universeBuilderV2] unexpected request error', {
        exchange: params.exchange,
        message: error?.message,
      });
      return [];
    }
  }

  console.warn('[universeBuilderV2] max retries reached', {
    exchange: params.exchange,
    marketCapMoreThan: params.marketCapMoreThan,
    marketCapLowerThan: params.marketCapLowerThan,
  });
  return [];
}

async function fetchExchangeRange(exchange, minCap, maxCap, depth = 0) {
  const rows = await fetchCompanyScreener({
    exchange,
    marketCapMoreThan: Math.max(0, Math.floor(minCap)),
    marketCapLowerThan: Math.max(1, Math.floor(maxCap)),
  });

  const span = maxCap - minCap;
  const shouldSplit = rows.length === REQUEST_LIMIT && depth <= MAX_DEPTH && span >= MIN_SPAN;

  if (!shouldSplit) {
    return rows;
  }

  const mid = minCap + span / 2;
  const left = await fetchExchangeRange(exchange, minCap, mid, depth + 1);
  const right = await fetchExchangeRange(exchange, mid, maxCap, depth + 1);
  return [...left, ...right];
}

function dedupeSymbols(rows) {
  const map = new Map();
  for (const row of rows) {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    if (!map.has(symbol)) map.set(symbol, row);
  }
  return Array.from(map.values());
}

async function buildUniverseV2() {
  if (!process.env.FMP_API_KEY) {
    console.warn('[universeBuilderV2] FMP_API_KEY missing');
    return [];
  }

  try {
    const allRows = [];

    for (const exchange of EXCHANGES) {
      const rows = await fetchExchangeRange(exchange, DEFAULT_MIN_CAP, DEFAULT_MAX_CAP, 0);
      allRows.push(...rows);
    }

    const deduped = dedupeSymbols(allRows)
      .filter(isIncludedStock)
      .map(mapRow)
      .filter((row) => row.symbol && EXCHANGES.includes(row.exchange));

    return dedupeSymbols(deduped);
  } catch (error) {
    console.warn('[universeBuilderV2] build failed softly', {
      message: error?.message,
    });
    return [];
  }
}

async function getUniverseV2() {
  const now = Date.now();
  if (universeCache && now - lastBuildTime < CACHE_TTL_MS) {
    return {
      data: universeCache,
      fromCache: true,
      lastBuildTime,
    };
  }

  const built = await buildUniverseV2();
  universeCache = built;
  lastBuildTime = Date.now();

  return {
    data: built,
    fromCache: false,
    lastBuildTime,
  };
}

module.exports = {
  getUniverseV2,
  buildUniverseV2,
};
