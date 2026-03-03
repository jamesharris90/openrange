// @ts-nocheck
const axios = require('axios');

const DIRECTORY_URL = 'https://financialmodelingprep.com/stable/company-screener';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 45_000;
const MIN_DIRECTORY_ROWS = 5_000;

let cache = null;
let cacheTs = 0;
let inFlightPromise = null;

function toText(value) {
  return String(value || '').trim();
}

function toUpper(value) {
  return toText(value).toUpperCase();
}

function toNullableNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeExchange(row) {
  const exchangeRaw = toUpper(row?.exchangeShortName || row?.exchange);
  if (exchangeRaw === 'NASDAQ') return 'NASDAQ';
  if (exchangeRaw === 'NYSE') return 'NYSE';
  if (exchangeRaw === 'AMEX' || exchangeRaw === 'NYSEARCA' || exchangeRaw === 'ARCA') return 'AMEX';

  const exchangeName = toUpper(row?.exchange);
  if (exchangeName.includes('NASDAQ')) return 'NASDAQ';
  if (exchangeName.includes('NEW YORK') || exchangeName.includes('NYSE')) return 'NYSE';
  if (exchangeName.includes('AMEX') || exchangeName.includes('ARCA')) return 'AMEX';
  return exchangeRaw;
}

function normalizeRow(row) {
  const symbol = toUpper(row?.symbol);
  const name = toText(row?.companyName || row?.name);
  const exchange = normalizeExchange(row);

  return {
    ...row,
    symbol,
    name,
    exchange,
    marketCap: toNullableNumber(row?.marketCap),
    price: toNullableNumber(row?.price),
    rawType: toText(row?.type || row?.assetType || row?.securityType) || null,
    country: toUpper(row?.country || row?.countryName),

    index: toText(row?.index || row?.indexName) || null,
    pe: pickNumber(row?.pe, row?.priceEarningsRatio),
    forwardPe: pickNumber(row?.forwardPE, row?.forwardPe),
    peg: pickNumber(row?.peg, row?.pegRatio),
    ps: pickNumber(row?.ps, row?.priceToSalesRatio),
    pb: pickNumber(row?.pb, row?.priceToBookRatio),
    priceToCash: pickNumber(row?.priceToCash, row?.priceToCashRatio),
    priceToFreeCashFlow: pickNumber(row?.priceToFreeCashFlow, row?.priceToFreeCashFlowsRatio),
    evToEbitda: pickNumber(row?.evToEbitda, row?.enterpriseValueOverEBITDA),
    evToSales: pickNumber(row?.evToSales, row?.enterpriseValueOverRevenue),

    high52Week: pickNumber(row?.high52Week, row?.yearHigh),
    low52Week: pickNumber(row?.low52Week, row?.yearLow),
    highAllTime: pickNumber(row?.highAllTime, row?.allTimeHigh),
    lowAllTime: pickNumber(row?.lowAllTime, row?.allTimeLow),

    relativeVolume: pickNumber(row?.relativeVolume, row?.rvol),
    avgVolume: pickNumber(row?.avgVolume, row?.averageVolume, row?.avgVolume3m),
    sharesOutstanding: pickNumber(row?.sharesOutstanding, row?.shares),
    floatShares: pickNumber(row?.floatShares, row?.sharesFloat),
    ipoDate: toText(row?.ipoDate || row?.ipo) || null,
  };
}

function isAllowedExchange(exchange) {
  return exchange === 'NASDAQ' || exchange === 'NYSE' || exchange === 'AMEX';
}

function hasAny(text, tokens) {
  return tokens.some((token) => text.includes(token));
}

function isEtfLike(sec) {
  const name = toUpper(sec.name);
  return hasAny(name, ['ETF', 'TRUST', 'FUND', ' 2X', ' 3X', 'SHARES', 'ETN']);
}

function isPreferredLike(sec) {
  const name = toUpper(sec.name);
  const symbol = toUpper(sec.symbol);
  return name.includes('PREFERRED') || symbol.includes('-') || symbol.endsWith('P');
}

function isAdrLike(sec) {
  const name = toUpper(sec.name);
  const country = toUpper(sec.country);
  if (name.includes(' ADR')) return true;
  if (name.includes(' PLC') && country !== 'US' && country !== 'USA') return true;
  if (name.includes(' SA') && country !== 'US' && country !== 'USA') return true;
  return false;
}

function isCommonStock(sec) {
  const name = toUpper(sec.name);
  if (!isAllowedExchange(sec.exchange)) return false;

  const exclusionTokens = [
    'ETF',
    'FUND',
    'TRUST',
    'SHARES',
    ' 2X',
    ' 3X',
    'PREFERRED',
    ' UNIT',
    ' RIGHTS',
    ' WARRANT',
    'ETN',
    ' LP',
    'HOLDINGS LTD',
  ];

  if (hasAny(name, exclusionTokens)) return false;
  return true;
}

async function fetchDirectoryRows(isActivelyTradingEnabled) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('FMP_API_KEY missing for directory fetch');
  }

  const params = {
    exchange: 'NASDAQ,NYSE,AMEX',
    limit: 10000,
    apikey: apiKey,
  };

  if (isActivelyTradingEnabled) {
    params.isActivelyTrading = 'true';
  }

  const response = await axios.get(DIRECTORY_URL, {
    params,
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Directory fetch failed with status ${response.status}`);
  }

  const rows = Array.isArray(response.data) ? response.data : [];
  return rows;
}

function classifyRows(rows) {
  const all = rows
    .filter((row) => row.symbol)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const etfs = all.filter(isEtfLike);
  const adrs = all.filter(isAdrLike);
  const preferred = all.filter(isPreferredLike);
  const commonStocks = all.filter(isCommonStock);

  const commonSet = new Set(commonStocks.map((row) => row.symbol));
  const etfSet = new Set(etfs.map((row) => row.symbol));
  const preferredSet = new Set(preferred.map((row) => row.symbol));

  const other = all.filter((row) => {
    return !commonSet.has(row.symbol) && !etfSet.has(row.symbol) && !preferredSet.has(row.symbol);
  });

  console.log('Directory Summary');
  console.log('Total Raw:', all.length);
  console.log('Common Stocks:', commonStocks.length);
  console.log('ETFs:', etfs.length);
  console.log('ADRs:', adrs.length);
  console.log('Preferred:', preferred.length);
  console.log('Other:', other.length);

  if (commonStocks.length < 3500 || commonStocks.length > 7000) {
    console.log('WARNING: Common stock count outside expected range');
  }

  return {
    all,
    commonStocks,
    etfs,
    adrs,
    preferred,
    other,
    fetchedAt: Date.now(),
  };
}

async function buildDirectory() {
  let firstError = null;

  try {
    const primaryRows = await fetchDirectoryRows(true);
    if (primaryRows.length >= MIN_DIRECTORY_ROWS) {
      return classifyRows(primaryRows.map(normalizeRow));
    }
    firstError = new Error(`Primary directory response too small: ${primaryRows.length}`);
  } catch (error) {
    firstError = error;
  }

  console.error('[directoryServiceV1] primary fetch failed or insufficient', {
    message: firstError?.message,
  });

  const fallbackRows = await fetchDirectoryRows(false);
  if (fallbackRows.length < MIN_DIRECTORY_ROWS) {
    console.error('[directoryServiceV1] FATAL directory integrity failure', {
      primaryError: firstError?.message,
      fallbackCount: fallbackRows.length,
    });
    throw new Error('Directory integrity failure: insufficient universe size');
  }

  return classifyRows(fallbackRows.map(normalizeRow));
}

async function getDirectoryData() {
  const now = Date.now();
  if (cache && now - cacheTs < CACHE_TTL_MS) {
    return cache;
  }

  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      const built = await buildDirectory();
      cache = built;
      cacheTs = Date.now();
      return built;
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}

async function refreshDirectoryData() {
  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      const built = await buildDirectory();
      cache = built;
      cacheTs = Date.now();
      return built;
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}

async function getCommonStocks() {
  const data = await getDirectoryData();
  return data.commonStocks;
}

async function getDirectorySummary() {
  const data = await getDirectoryData();
  return {
    totalRaw: data.all.length,
    commonStocks: data.commonStocks.length,
    etfs: data.etfs.length,
    adrs: data.adrs.length,
    preferred: data.preferred.length,
    other: data.other.length,
    samples: {
      common: data.commonStocks.slice(0, 5),
      etfs: data.etfs.slice(0, 5),
    },
  };
}

function normalizeBucket(value) {
  const raw = toUpper(value);
  if (raw === 'COMMON' || raw === 'COMMONSTOCKS' || raw === 'COMMON_STOCKS') return 'common';
  if (raw === 'ETF' || raw === 'ETFS') return 'etf';
  if (raw === 'ADR' || raw === 'ADRS') return 'adr';
  if (raw === 'PREFERRED' || raw === 'PREFERREDS') return 'preferred';
  if (raw === 'OTHER' || raw === 'OTHERS') return 'other';
  return '';
}

async function getStocksByBuckets(bucketsInput) {
  const data = await getDirectoryData();
  const buckets = Array.isArray(bucketsInput) && bucketsInput.length
    ? bucketsInput.map(normalizeBucket).filter(Boolean)
    : ['common'];

  const unique = Array.from(new Set(buckets));
  const map = new Map();

  for (const bucket of unique) {
    const source =
      bucket === 'common' ? data.commonStocks
        : bucket === 'etf' ? data.etfs
          : bucket === 'adr' ? data.adrs
            : bucket === 'preferred' ? data.preferred
              : bucket === 'other' ? data.other
                : [];

    source.forEach((row) => {
      const symbol = toUpper(row?.symbol);
      if (!symbol) return;
      if (!map.has(symbol)) {
        map.set(symbol, {
          ...row,
          directoryBucket: bucket,
        });
      }
    });
  }

  return Array.from(map.values());
}

module.exports = {
  getDirectoryData,
  refreshDirectoryData,
  getCommonStocks,
  getStocksByBuckets,
  getDirectorySummary,
};
