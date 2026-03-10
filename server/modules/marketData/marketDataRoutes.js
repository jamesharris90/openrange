const express = require('express');
const axios = require('axios');
const marketCache = require('../../cache/marketCache');
const { queryWithTimeout } = require('../../db/pg');

const router = express.Router();
const FMP_BASE = 'https://financialmodelingprep.com';
const FMP_KEY = process.env.FMP_API_KEY;

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'IWM', '^VIX', 'DX-Y.NYB', '^TNX'];
const TICKER_TAPE_SYMBOLS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMD', 'META', 'AMZN'];
const INDEX_TARGETS = [
  { key: 'spy', symbol: 'SPY', aliases: ['SPY'] },
  { key: 'qqq', symbol: 'QQQ', aliases: ['QQQ'] },
  { key: 'iwm', symbol: 'IWM', aliases: ['IWM'] },
  { key: 'vix', symbol: 'VIX', aliases: ['VIX', '^VIX'] },
  { key: 'dxy', symbol: 'DXY', aliases: ['DXY', 'DX-Y.NYB'] },
  { key: 'tenYear', symbol: '10Y', aliases: ['10Y', 'TNX', '^TNX', 'US10Y'] },
];

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
  let quoteRows = [];
  let dbRows = [];

  const apiKey = getApiKey();
  try {
    if (apiKey) {
      quoteRows = await fetchQuotes(INDEX_SYMBOLS, apiKey);
    }
  } catch (_error) {
    quoteRows = [];
  }

  try {
    const [metricsResult, quotesResult] = await Promise.all([
      queryWithTimeout(
      `SELECT
         m.symbol,
        NULL::numeric AS change,
         COALESCE(m.change_percent, q.change_percent, 0) AS change_percent,
         COALESCE(m.price, q.price, 0) AS price
       FROM market_metrics m
       LEFT JOIN market_quotes q ON q.symbol = m.symbol
       WHERE m.symbol = ANY($1::text[])
       LIMIT 20`,
      [['SPY', 'QQQ', 'IWM', 'VIX', 'DXY', '10Y', 'TNX', '^TNX', 'DX-Y.NYB']],
      { timeoutMs: 1200, label: 'market.routes.indices.metrics_fallback', maxRetries: 0 }
      ),
      queryWithTimeout(
        `SELECT
           q.symbol,
           NULL::numeric AS change,
           COALESCE(q.change_percent, 0) AS change_percent,
           q.price AS price
         FROM market_quotes q
         WHERE q.symbol = ANY($1::text[])
         LIMIT 20`,
        [['SPY', 'QQQ', 'IWM', 'VIX', 'DXY', '10Y', 'TNX', '^TNX', 'DX-Y.NYB']],
        { timeoutMs: 1200, label: 'market.routes.indices.quotes_fallback', maxRetries: 0 }
      ),
    ]);
    dbRows = [...(metricsResult.rows || []), ...(quotesResult.rows || [])];
  } catch (_error) {
    dbRows = [];
  }

  const quoteMap = new Map((quoteRows || []).map((row) => [String(row?.symbol || '').toUpperCase(), row]));
  const dbMap = new Map((dbRows || []).map((row) => [String(row?.symbol || '').toUpperCase(), row]));

  const pick = (aliases) => {
    for (const alias of aliases) {
      const quote = quoteMap.get(String(alias).toUpperCase());
      if (quote && Number.isFinite(Number(quote?.price))) {
        return {
          price: toNum(quote?.price),
          change: toNum(quote?.change),
          percent: toNum(quote?.changesPercentage),
        };
      }
      const db = dbMap.get(String(alias).toUpperCase());
      if (db && Number.isFinite(Number(db?.price))) {
        return {
          price: toNum(db?.price),
          change: toNum(db?.change),
          percent: toNum(db?.change_percent),
        };
      }
    }
    return { price: null, change: null, percent: null };
  };

  const keyed = {};
  const indices = INDEX_TARGETS.map((target) => {
    const normalized = pick(target.aliases);
    keyed[target.key] = normalized;
    return {
      symbol: target.symbol,
      price: normalized.price,
      change: normalized.change,
      changePercent: normalized.percent,
      change_percent: normalized.percent,
      percent: normalized.percent,
    };
  });

  return res.json({
    success: true,
    degraded: quoteRows.length === 0,
    indices,
    ...keyed,
  });
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
