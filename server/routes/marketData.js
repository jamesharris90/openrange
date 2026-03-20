const express = require('express');
const axios = require('axios');
const marketCache = require('../cache/marketCache');
const { normalizeSymbol, mapToProviderSymbol, mapFromProviderSymbol } = require('../utils/symbolMap');

const router = express.Router();

const FMP_BASE = 'https://financialmodelingprep.com';
const INDEX_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'VIX'];
const TICKER_TAPE_SYMBOLS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMD', 'META', 'AMZN'];

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getApiKey() {
  return String(process.env.FMP_API_KEY || '').trim();
}

async function fetchQuoteBatch(symbols, apiKey) {
  const canonicalSymbols = (Array.isArray(symbols) ? symbols : [])
    .map((symbol) => mapFromProviderSymbol(normalizeSymbol(symbol)))
    .filter(Boolean);
  const providerSymbols = canonicalSymbols.map((symbol) => mapToProviderSymbol(symbol));

  if (canonicalSymbols.length === 1) {
    const symbol = canonicalSymbols[0];
    const cacheKey = `quote_${symbol}`;
    const cached = marketCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const joined = providerSymbols.join(',');
  const response = await axios.get(`${FMP_BASE}/stable/quote`, {
    params: { symbol: joined, apikey: apiKey },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`FMP quote batch failed with status ${response.status}`);
  }

  const data = (Array.isArray(response.data) ? response.data : []).map((row) => ({
    ...row,
    symbol: mapFromProviderSymbol(normalizeSymbol(row?.symbol)),
  }));

  if (canonicalSymbols.length === 1) {
    const symbol = canonicalSymbols[0];
    const cacheKey = `quote_${symbol}`;
    marketCache.set(cacheKey, data);
  }

  return data;
}

function normalizeQuoteRow(row) {
  return {
    symbol: String(row?.symbol || '').toUpperCase(),
    price: toNum(row?.price),
    change: toNum(row?.change),
    changesPercentage: toNum(row?.changesPercentage),
    changePercent: toNum(row?.changesPercentage),
    change_percent: toNum(row?.changesPercentage),
    volume: toNum(row?.volume),
    dayHigh: toNum(row?.dayHigh),
    dayLow: toNum(row?.dayLow),
  };
}

async function fetchProfile(symbol, apiKey) {
  const response = await axios.get(`${FMP_BASE}/stable/profile`, {
    params: { symbol, apikey: apiKey },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) return null;
  const row = Array.isArray(response.data) ? response.data[0] : null;
  return row || null;
}

router.get('/api/quote', async (req, res) => {
  const symbol = mapFromProviderSymbol(normalizeSymbol(req.query.symbol || req.query.t));
  if (!symbol) {
    return res.status(400).json({ success: false, error: 'symbol is required' });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.json({
      success: false,
      symbol,
      price: null,
      change: null,
      changesPercentage: null,
      changePercent: null,
      change_percent: null,
      volume: null,
      dayHigh: null,
      dayLow: null,
      sector: null,
      warning: 'MARKET_DATA_UNAVAILABLE',
    });
  }

  try {
    const providerSymbol = mapToProviderSymbol(symbol);
    const [quotes, profile] = await Promise.all([
      fetchQuoteBatch([symbol], apiKey),
      fetchProfile(providerSymbol, apiKey),
    ]);

    const match = quotes.find((row) => String(row?.symbol || '').toUpperCase() === symbol) || quotes[0];
    if (!match) {
      return res.json({
        success: false,
        symbol,
        price: null,
        change: null,
        changesPercentage: null,
        changePercent: null,
        change_percent: null,
        volume: null,
        dayHigh: null,
        dayLow: null,
        sector: null,
        warning: 'QUOTE_NOT_FOUND',
      });
    }

    return res.json({
      ...normalizeQuoteRow(match),
      sector: profile?.sector || null,
    });
  } catch (error) {
    return res.json({
      success: false,
      symbol,
      price: null,
      change: null,
      changesPercentage: null,
      changePercent: null,
      change_percent: null,
      volume: null,
      dayHigh: null,
      dayLow: null,
      sector: null,
      warning: 'QUOTE_FALLBACK',
      detail: error.message,
    });
  }
});

router.get('/api/chart/mini/:symbol', async (req, res) => {
  const symbol = mapFromProviderSymbol(normalizeSymbol(req.params.symbol));
  const providerSymbol = mapToProviderSymbol(symbol);
  if (!symbol) {
    return res.status(400).json({ success: false, error: 'symbol is required' });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.json([]);
  }

  try {
    const response = await axios.get(`${FMP_BASE}/stable/historical-price-eod`, {
      params: {
        symbol: providerSymbol,
        apikey: apiKey,
        limit: 30,
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`FMP mini chart failed with status ${response.status}`);
    }

    const historical = Array.isArray(response.data)
      ? response.data
      : (Array.isArray(response.data?.historical) ? response.data.historical : []);
    const points = historical
      .slice()
      .reverse()
      .map((row) => {
        const ts = Date.parse(String(row?.date || ''));
        const time = Number.isFinite(ts) ? Math.floor(ts / 1000) : null;
        const value = toNum(row?.close);
        if (!Number.isFinite(time) || !Number.isFinite(value)) return null;
        return { time, value };
      })
      .filter(Boolean);

    return res.json(points);
  } catch (error) {
    return res.json([]);
  }
});

router.get('/api/market/indices', async (_req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.json({ success: false, error: 'Market data unavailable', indices: [] });
  }

  try {
    const quotes = await fetchQuoteBatch(INDEX_SYMBOLS, apiKey);
    const map = new Map(quotes.map((row) => [String(row?.symbol || '').toUpperCase(), row]));

    const indices = INDEX_SYMBOLS.map((symbol) => {
      const row = map.get(String(symbol).toUpperCase()) || {};
      return {
        symbol,
        price: toNum(row?.price),
        change: toNum(row?.change),
        changePercent: toNum(row?.changesPercentage),
        change_percent: toNum(row?.changesPercentage),
      };
    });

    return res.json({
      success: true,
      indices,
      SPY: indices.find((row) => row.symbol === 'SPY') || null,
      QQQ: indices.find((row) => row.symbol === 'QQQ') || null,
      IWM: indices.find((row) => row.symbol === 'IWM') || null,
      VIX: indices.find((row) => row.symbol === 'VIX') || null,
    });
  } catch (error) {
    return res.json({ success: false, error: 'Failed to fetch market indices', detail: error.message, indices: [] });
  }
});

router.get('/api/market/tickers', async (_req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.json({ success: false, error: 'Market data unavailable', tickers: [] });
  }

  try {
    const quotes = await fetchQuoteBatch(TICKER_TAPE_SYMBOLS, apiKey);
    const map = new Map(quotes.map((row) => [String(row?.symbol || '').toUpperCase(), row]));

    const tickers = TICKER_TAPE_SYMBOLS.map((symbol) => {
      const row = map.get(symbol) || {};
      return {
        symbol,
        price: toNum(row?.price),
        change: toNum(row?.change),
        changePercent: toNum(row?.changesPercentage),
        change_percent: toNum(row?.changesPercentage),
        volume: toNum(row?.volume),
      };
    });

    return res.json({ success: true, tickers });
  } catch (error) {
    return res.json({ success: false, error: 'Failed to fetch ticker tape', detail: error.message, tickers: [] });
  }
});

module.exports = router;
