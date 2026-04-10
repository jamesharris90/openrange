const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 12000;
const BASE_URL = String(process.env.UNUSUAL_WHALES_BASE_URL || '').trim();
const API_KEY = String(process.env.UNUSUAL_WHALES_API_KEY || '').trim();
const QUOTE_PATH = String(process.env.UNUSUAL_WHALES_QUOTE_PATH || '/api/stock/{symbol}/quote').trim();
const EARNINGS_PATH = String(process.env.UNUSUAL_WHALES_EARNINGS_PATH || '/api/stock/{symbol}/earnings').trim();
const NEWS_PATH = String(process.env.UNUSUAL_WHALES_NEWS_PATH || '/api/stock/{symbol}/news?limit=50').trim();

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function fillPath(template, symbol) {
  return String(template || '').replaceAll('{symbol}', encodeURIComponent(symbol));
}

function getHeaders() {
  const headers = {
    Accept: 'application/json',
  };

  if (API_KEY) {
    headers.Authorization = `Bearer ${API_KEY}`;
    headers['x-api-key'] = API_KEY;
  }

  return headers;
}

function deepFindNumber(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const numeric = toNumber(value[key]);
      if (numeric !== null) return numeric;
    }
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      const numeric = deepFindNumber(nested, keys);
      if (numeric !== null) return numeric;
    }
  }
  return null;
}

function deepFindString(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const text = String(value[key] || '').trim();
      if (text) return text;
    }
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      const text = deepFindString(nested, keys);
      if (text) return text;
    }
  }
  return null;
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function fetchJson(pathname) {
  if (!BASE_URL || !API_KEY) {
    return { ok: false, status: null, payload: null, error: 'unconfigured' };
  }

  try {
    const response = await axios.get(`${BASE_URL}${pathname}`, {
      timeout: DEFAULT_TIMEOUT_MS,
      validateStatus: () => true,
      headers: getHeaders(),
    });

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      payload: response.data,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      payload: null,
      error: error.message || 'request_failed',
    };
  }
}

async function fetchSymbolAuditData(symbol) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!normalizedSymbol) {
    return {
      provider: 'unusual_whales',
      available: false,
      symbol: null,
      error: 'symbol_required',
    };
  }

  if (!BASE_URL || !API_KEY) {
    return {
      provider: 'unusual_whales',
      available: false,
      symbol: normalizedSymbol,
      error: 'UNUSUAL_WHALES_NOT_CONFIGURED',
    };
  }

  const [quoteResult, earningsResult, newsResult] = await Promise.all([
    fetchJson(fillPath(QUOTE_PATH, normalizedSymbol)),
    fetchJson(fillPath(EARNINGS_PATH, normalizedSymbol)),
    fetchJson(fillPath(NEWS_PATH, normalizedSymbol)),
  ]);

  const quotePayload = quoteResult.payload || {};
  const earningsPayload = earningsResult.payload || {};
  const newsRows = extractArray(newsResult.payload);

  return {
    provider: 'unusual_whales',
    available: quoteResult.ok || earningsResult.ok || newsResult.ok,
    symbol: normalizedSymbol,
    price: deepFindNumber(quotePayload, ['price', 'last', 'last_price', 'close']),
    change_percent: deepFindNumber(quotePayload, ['change_percent', 'percent_change', 'pct_change', 'changePct']),
    volume: deepFindNumber(quotePayload, ['volume', 'total_volume']),
    earnings_date: normalizeDateKey(deepFindString(earningsPayload, ['earnings_date', 'report_date', 'date', 'next_earnings_date'])),
    news_count: newsRows.length,
    errors: [quoteResult.error, earningsResult.error, newsResult.error].filter(Boolean),
  };
}

module.exports = {
  fetchSymbolAuditData,
};