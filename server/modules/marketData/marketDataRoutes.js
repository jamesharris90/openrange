const express = require('express');
const axios = require('axios');
const marketCache = require('../../cache/marketCache');

const router = express.Router();
const FMP_BASE = 'https://financialmodelingprep.com';
const FMP_KEY = process.env.FMP_API_KEY;

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'IWM', '^VIX'];
const TICKER_TAPE_SYMBOLS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMD', 'META', 'AMZN'];

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getApiKey() {
  return String(FMP_KEY || '').trim();
}

function degradedResponse(extra = {}) {
  return {
    success: false,
    degraded: true,
    ...extra,
  };
}

async function fetchQuotes(symbols, apiKey) {
  if (symbols.length === 1) {
    const symbol = String(symbols[0] || '').trim().toUpperCase();
    const cacheKey = `quote_${symbol}`;
    const cached = marketCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const joined = symbols.join(',');
  const response = await axios.get(`${FMP_BASE}/stable/quote`, {
    params: { symbol: joined, apikey: apiKey },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`FMP quote failed: ${response.status}`);
  }

  const data = Array.isArray(response.data) ? response.data : [];

  if (symbols.length === 1) {
    const symbol = String(symbols[0] || '').trim().toUpperCase();
    const cacheKey = `quote_${symbol}`;
    marketCache.set(cacheKey, data);
  }

  return data;
}

router.get('/quote', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!symbol) {
    return res.status(400).json(degradedResponse({ error: 'symbol is required' }));
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.json(degradedResponse({ symbol, quote: null }));
  }

  try {
    const quotes = await fetchQuotes([symbol], apiKey);
    const row = quotes.find((q) => String(q?.symbol || '').toUpperCase() === symbol);
    if (!row) {
      return res.json(degradedResponse({ symbol, quote: null }));
    }

    return res.json({
      symbol,
      price: toNum(row.price),
      change: toNum(row.change),
      changesPercentage: toNum(row.changesPercentage),
      volume: toNum(row.volume),
      dayHigh: toNum(row.dayHigh),
      dayLow: toNum(row.dayLow),
    });
  } catch (error) {
    return res.json(degradedResponse({ symbol, detail: error.message }));
  }
});

router.get('/chart-mini/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!symbol) {
    return res.status(400).json(degradedResponse({ error: 'symbol is required' }));
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.json([]);
  }

  try {
    const response = await axios.get(`${FMP_BASE}/stable/historical-price-eod`, {
      params: {
        symbol,
        limit: 30,
        apikey: apiKey,
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`FMP mini chart failed: ${response.status}`);
    }

    const rows = Array.isArray(response.data)
      ? response.data
      : (Array.isArray(response.data?.historical) ? response.data.historical : []);
    const points = rows
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
  } catch (_error) {
    return res.json([]);
  }
});

router.get('/indices', async (_req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.json([]);
  }

  try {
    const rows = await fetchQuotes(INDEX_SYMBOLS, apiKey);
    const map = new Map(rows.map((row) => [String(row?.symbol || '').toUpperCase(), row]));

    const indices = INDEX_SYMBOLS.map((symbol) => {
      const row = map.get(String(symbol).toUpperCase()) || {};
      return {
        symbol: symbol === '^VIX' ? 'VIX' : symbol,
        price: toNum(row.price),
        change: toNum(row.change),
        changesPercentage: toNum(row.changesPercentage),
      };
    });

    return res.json(indices);
  } catch (_error) {
    return res.json([]);
  }
});

router.get('/ticker-tape', async (_req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.json([]);
  }

  try {
    const rows = await fetchQuotes(TICKER_TAPE_SYMBOLS, apiKey);
    const map = new Map(rows.map((row) => [String(row?.symbol || '').toUpperCase(), row]));

    const data = TICKER_TAPE_SYMBOLS.map((symbol) => {
      const row = map.get(symbol) || {};
      return {
        symbol,
        price: toNum(row.price),
        change: toNum(row.change),
        changesPercentage: toNum(row.changesPercentage),
        volume: toNum(row.volume),
      };
    });

    return res.json(data);
  } catch (_error) {
    return res.json([]);
  }
});

module.exports = router;
