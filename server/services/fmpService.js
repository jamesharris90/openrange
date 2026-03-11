const axios = require('axios');
const limitProvider = require('../utils/providerLimiter');

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const QUOTE_CONCURRENCY = 5;
const QUOTE_REQUEST_DELAY_MS = 100;
const BATCH_DELAY_MS = 250;
const QUOTE_MAX_RETRIES = 3;
const ALLOWED_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'CBOE']);
const SCREEN_PAGE_LIMIT = 1000;
const MAX_MARKET_CAP = 10_000_000_000_000; // 10T
const MAX_SPLIT_DEPTH = 12;
const MIN_SPLIT_SPAN = 5_000_000; // 5M
const PRICE_BUCKETS = [
  [0, 1],
  [1, 2],
  [2, 5],
  [5, 10],
  [10, 20],
  [20, 50],
  [50, 100],
  [100, 200],
  [200, 500],
  [500, 1000],
  [1000, null],
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatLargeNumber(value) {
  const n = toNumber(value);
  if (n == null) return null;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

function normalizeExchange(item) {
  return String(item.exchangeShortName || item.exchange || '').toUpperCase();
}

function isCommonStock(item) {
  const type = String(item.type || 'stock').toLowerCase();
  const exchange = normalizeExchange(item);
  const symbol = String(item.symbol || '').toUpperCase();
  return (
    type === 'stock' &&
    ALLOWED_EXCHANGES.has(exchange) &&
    symbol.length > 0
  );
}

async function fetchCompanyScreenerSlice(exchange, marketCapMin, marketCapMax, priceMin = null, priceMax = null) {
  const apiKey = process.env.FMP_API_KEY || '';
  const params = new URLSearchParams({
    exchange,
    limit: String(SCREEN_PAGE_LIMIT),
    isActivelyTrading: 'true',
    isEtf: 'false',
    isFund: 'false',
    apikey: apiKey,
  });
  if (marketCapMin != null) params.set('marketCapMoreThan', String(Math.floor(marketCapMin)));
  if (marketCapMax != null) params.set('marketCapLowerThan', String(Math.floor(marketCapMax)));
  if (priceMin != null) params.set('priceMoreThan', String(priceMin));
  if (priceMax != null) params.set('priceLowerThan', String(priceMax));
  const url = `${FMP_BASE_URL}/company-screener?${params.toString()}`;

  // Retry on 429 with exponential backoff
  const maxRetries = 5;
  let lastStatus = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await limitProvider(() =>
      axios.get(url, { timeout: 30000, validateStatus: () => true })
    );
    lastStatus = response.status;
    if (response.status === 200) {
      return Array.isArray(response.data) ? response.data : [];
    }
    if (response.status === 429) {
      const backoff = Math.min(2000 * 2 ** attempt, 30000);
      await delay(backoff);
      continue;
    }
    throw new Error(`FMP company-screener failed with status ${response.status}`);
  }
  throw new Error(`FMP company-screener rate-limited after ${maxRetries} retries (429)`);
}

async function collectByPriceBuckets(exchange, minCap, maxCap) {
  const rows = [];
  for (const [pMin, pMax] of PRICE_BUCKETS) {
    const bucketRows = await fetchCompanyScreenerSlice(exchange, minCap, maxCap, pMin, pMax);
    rows.push(...bucketRows);
    await delay(BATCH_DELAY_MS);
  }
  return rows;
}

async function collectExchangeUniverse(exchange, minCap, maxCap, depth = 0) {
  const rows = await fetchCompanyScreenerSlice(exchange, minCap, maxCap);
  if (rows.length < SCREEN_PAGE_LIMIT) return rows;

  const span = maxCap - minCap;
  if (depth >= MAX_SPLIT_DEPTH || span <= MIN_SPLIT_SPAN) {
    // Cap range saturated at endpoint limit, slice by price bands to recover additional symbols.
    return collectByPriceBuckets(exchange, minCap, maxCap);
  }

  const mid = minCap + span / 2;
  await delay(BATCH_DELAY_MS);
  const left = await collectExchangeUniverse(exchange, minCap, mid, depth + 1);
  await delay(BATCH_DELAY_MS);
  const right = await collectExchangeUniverse(exchange, mid, maxCap, depth + 1);
  return [...left, ...right];
}

async function fetchStockList() {
  const rawRows = [];

  for (const exchange of ALLOWED_EXCHANGES) {
    const rows = await collectExchangeUniverse(exchange, 0, MAX_MARKET_CAP, 0);
    rawRows.push(...rows);
    await delay(BATCH_DELAY_MS);
  }

  console.log('Raw stock-list count:', rawRows.length);

  const dedup = new Map();
  rawRows.forEach((row) => {
    const symbol = String(row.symbol || '').trim().toUpperCase();
    if (!symbol) return;
    if (!dedup.has(symbol)) dedup.set(symbol, row);
  });

  const filtered = Array.from(dedup.values()).filter(isCommonStock);
  const byExchange = {};
  filtered.forEach((row) => {
    const ex = normalizeExchange(row);
    byExchange[ex] = (byExchange[ex] || 0) + 1;
  });
  console.log('Filtered US stock count:', filtered.length);
  console.log('Filtered exchange breakdown:', byExchange);
  // Normalize exchange to short name ("NASDAQ Global Market" → "NASDAQ") so
  // filterEngine strict-match and frontend display both work correctly.
  return filtered.map((row) => ({ ...row, exchange: normalizeExchange(row) }));
}

async function fetchQuotesBatch(symbols) {
  const apiKey = process.env.FMP_API_KEY || '';
  const cleanSymbols = Array.isArray(symbols)
    ? symbols.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)
    : [];

  const quotesMap = new Map();
  let cursor = 0;

  async function fetchSingle(symbol, attempt = 1) {
    const url = `${FMP_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    console.log('Calling FMP with:', url);
    const response = await limitProvider(() =>
      axios.get(url, { timeout: 30000, validateStatus: () => true })
    );

    if (response.status === 429) {
      if (attempt >= QUOTE_MAX_RETRIES) {
        throw new Error(`FMP quote endpoint returned 429 for ${symbol}`);
      }
      const backoff = 250 * (2 ** (attempt - 1));
      await delay(backoff);
      return fetchSingle(symbol, attempt + 1);
    }

    if (response.status !== 200) {
      throw new Error(`FMP quote failed for ${symbol} with status ${response.status}`);
    }

    const rows = Array.isArray(response.data) ? response.data : [];
    return rows[0] || null;
  }

  async function worker() {
    while (cursor < cleanSymbols.length) {
      const idx = cursor++;
      const symbol = cleanSymbols[idx];
      try {
        const quote = await fetchSingle(symbol, 1);
        if (quote) {
          quotesMap.set(symbol, quote);
        }
      } catch (err) {
        console.log(`Quote fetch failed for ${symbol}:`, err.message);
      }

      if (idx + 1 < cleanSymbols.length) {
        await delay(QUOTE_REQUEST_DELAY_MS);
      }
    }
  }

  const workerCount = Math.min(QUOTE_CONCURRENCY, cleanSymbols.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const allQuotes = Array.from(quotesMap.values());
  console.log('Total quote records returned:', allQuotes.length);
  return allQuotes;
}

async function buildUniverseDataset() {
  const stocks = await fetchStockList();
  const symbols = stocks.map((item) => String(item.symbol || '').trim().toUpperCase()).filter(Boolean);
  let quoteBySymbol = new Map();
  try {
    const quotes = await fetchQuotesBatch(symbols);
    quoteBySymbol = new Map(
      quotes
        .map((row) => [String(row.symbol || '').trim().toUpperCase(), row])
        .filter(([symbol]) => Boolean(symbol))
    );
  } catch (err) {
    console.log('Quote enrichment fallback in use:', err.message);
  }

  const merged = stocks.map((stock) => {
      const symbol = String(stock.symbol || '').trim().toUpperCase();
      const quote = quoteBySymbol.get(symbol) || {};
      const price = toNumber(quote.price ?? stock.price);
      const prevClose = toNumber(quote.previousClose ?? stock.previousClose ?? null);
      const volume = toNumber(quote.volume ?? stock.volume);
      const marketCap = toNumber(quote.marketCap ?? stock.marketCap);
      const exchange = normalizeExchange(stock) || String(quote.exchange || '').toUpperCase();

      const quoteChange = toNumber(quote.change);
      const quoteChangePct = toNumber(quote.changePercentage ?? quote.changesPercentage);
      const change = quoteChange != null
        ? quoteChange
        : price != null && prevClose != null
          ? price - prevClose
          : null;
      const changePercent = quoteChangePct != null
        ? quoteChangePct
        : change != null && prevClose
          ? (change / prevClose) * 100
          : null;

      return {
        symbol,
        name: String(quote.name || stock.companyName || stock.name || ''),
        exchange,
        price: price ?? 0,
        prevClose,
        change,
        changePercent,
        volume: volume ?? 0,
        marketCap,
        formattedMarketCap: formatLargeNumber(marketCap),
        volumeMillions: volume != null ? volume / 1_000_000 : null,
      };
    });

  console.log('Final merged dataset count:', merged.length);
  return merged;
}

module.exports = {
  fetchStockList,
  fetchQuotesBatch,
  buildUniverseDataset,
};
