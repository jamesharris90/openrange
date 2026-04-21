const axios = require('axios');
const { getMarketSession } = require('../utils/marketSession');

const FMP_BATCH_QUOTE_URL = 'https://financialmodelingprep.com/stable/batch-quote';
const FMP_BATCH_AFTERMARKET_TRADE_URL = 'https://financialmodelingprep.com/stable/batch-aftermarket-trade';
const FMP_BATCH_AFTERMARKET_QUOTE_URL = 'https://financialmodelingprep.com/stable/batch-aftermarket-quote';
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

function midpoint(bidPrice, askPrice) {
  const bid = toNumber(bidPrice);
  const ask = toNumber(askPrice);
  if (bid === null && ask === null) return null;
  if (bid === null) return ask;
  if (ask === null) return bid;
  return (bid + ask) / 2;
}

function mergeExtendedQuoteData(baseQuotes, extendedTrades, extendedQuotes, session) {
  if (session !== 'PREMARKET' && session !== 'POSTMARKET') {
    return baseQuotes;
  }

  const tradeBySymbol = new Map(
    (extendedTrades || [])
      .filter((row) => row?.symbol)
      .map((row) => [String(row.symbol).trim().toUpperCase(), row])
  );
  const quoteBySymbol = new Map(
    (extendedQuotes || [])
      .filter((row) => row?.symbol)
      .map((row) => [String(row.symbol).trim().toUpperCase(), row])
  );

  return baseQuotes.map((quote) => {
    const symbol = String(quote?.symbol || '').trim().toUpperCase();
    const trade = tradeBySymbol.get(symbol);
    const extendedQuote = quoteBySymbol.get(symbol);
    const tradePrice = toNumber(trade?.price);
    const quoteMidpoint = midpoint(extendedQuote?.bidPrice, extendedQuote?.askPrice);
    const bidPrice = toNumber(extendedQuote?.bidPrice);
    const askPrice = toNumber(extendedQuote?.askPrice);
    const extendedPrice = tradePrice ?? quoteMidpoint ?? bidPrice ?? askPrice;
    const extendedTimestamp = trade?.timestamp ?? extendedQuote?.timestamp ?? null;
    const extendedVolume = toNumber(extendedQuote?.volume);
    const previousClose = toNumber(quote?.previousClose) ?? toNumber(quote?.close) ?? toNumber(quote?.price);

    if (extendedPrice === null || extendedTimestamp === null) {
      return quote;
    }

    const changePercent = previousClose && previousClose > 0
      ? ((extendedPrice - previousClose) / previousClose) * 100
      : quote.percent;

    return {
      ...quote,
      price: extendedPrice,
      changePercentage: changePercent,
      changesPercentage: changePercent,
      volume: extendedVolume ?? quote.volume,
      timestamp: extendedTimestamp,
    };
  });
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
  const session = getMarketSession();
  const cacheKey = `${session}:${normalizedSymbols}`;
  if (!cacheKey) {
    return [];
  }

  const cached = getCachedQuotes(cacheKey);
  if (cached) return cached;

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('FMP_API_KEY missing');
  }

  const requestConfig = {
    params: {
      symbols: normalizedSymbols,
      apikey: apiKey,
    },
    timeout: 15000,
    validateStatus: () => true,
  };

  const [quoteResponse, extendedTradeResponse, extendedQuoteResponse] = await Promise.all([
    axios.get(FMP_BATCH_QUOTE_URL, requestConfig),
    session === 'PREMARKET' || session === 'POSTMARKET'
      ? axios.get(FMP_BATCH_AFTERMARKET_TRADE_URL, requestConfig).catch(() => ({ status: 0, data: [] }))
      : Promise.resolve({ status: 0, data: [] }),
    session === 'PREMARKET' || session === 'POSTMARKET'
      ? axios.get(FMP_BATCH_AFTERMARKET_QUOTE_URL, requestConfig).catch(() => ({ status: 0, data: [] }))
      : Promise.resolve({ status: 0, data: [] }),
  ]);

  if (quoteResponse.status < 200 || quoteResponse.status >= 300) {
    throw new Error(`FMP batch quote failed with status ${quoteResponse.status}`);
  }

  const baseRows = Array.isArray(quoteResponse.data) ? quoteResponse.data : [];
  const extendedTradeRows = extendedTradeResponse.status >= 200 && extendedTradeResponse.status < 300 && Array.isArray(extendedTradeResponse.data)
    ? extendedTradeResponse.data
    : [];
  const extendedQuoteRows = extendedQuoteResponse.status >= 200 && extendedQuoteResponse.status < 300 && Array.isArray(extendedQuoteResponse.data)
    ? extendedQuoteResponse.data
    : [];

  const normalized = mergeExtendedQuoteData(
    baseRows,
    extendedTradeRows,
    extendedQuoteRows,
    session
  )
    .map(normalizeQuoteRow)
    .filter((quote) => quote.symbol.length > 0);

  setCachedQuotes(cacheKey, normalized);
  return normalized;
}

module.exports = {
  fetchBatchQuotes,
};
