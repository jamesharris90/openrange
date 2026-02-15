const axios = require('axios');
const cache = require('../utils/cache');
const { withRetry } = require('../utils/retry');
const { POLYGON_API_KEY } = require('../utils/config');

const QUOTE_TTL = 30 * 1000;

function mapPrevAgg(sym, data) {
  if (!data || !data.results || !data.results[0]) return null;
  const r = data.results[0];
  return {
    symbol: sym,
    price: r.c ?? null,
    change: null,
    changePercent: null,
    marketCap: null,
    avgVolume: null,
    volume: r.v ?? null,
    rvol: null,
    preMarketPrice: null,
    preMarketChange: null,
    preMarketChangePercent: null,
  };
}

async function getQuotes(symbols = []) {
  if (!POLYGON_API_KEY) throw new Error('POLYGON_API_KEY missing');
  const list = Array.isArray(symbols) ? symbols : String(symbols).split(',');
  const results = [];
  for (const sym of list) {
    const key = `pq:${sym}`;
    const cached = cache.get(key);
    if (cached) { results.push(cached); continue; }
    const url = `https://api.polygon.io/v2/aggs/ticker/${sym}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`;
    const resp = await withRetry(() => axios.get(url, { timeout: 8000 }));
    const mapped = mapPrevAgg(sym, resp.data);
    if (mapped) cache.set(key, mapped, QUOTE_TTL);
    if (mapped) results.push(mapped);
  }
  return results;
}

async function getHistorical(symbol, { timespan = 'day', from, to, limit = 120 } = {}) {
  if (!POLYGON_API_KEY) throw new Error('POLYGON_API_KEY missing');
  const key = `ph:${symbol}:${timespan}:${from || ''}:${to || ''}:${limit}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/${timespan}/${from || '2024-01-01'}/${to || '2024-12-31'}?adjusted=true&sort=asc&limit=${limit}&apiKey=${POLYGON_API_KEY}`;
  const resp = await withRetry(() => axios.get(url, { timeout: 10000 }));
  cache.set(key, resp.data, 5 * 60 * 1000);
  return resp.data;
}

module.exports = {
  name: 'polygon',
  getQuotes,
  getHistorical,
};
