const axios = require('axios');
const cache = require('../utils/cache');
const { withRetry } = require('../utils/retry');
const { FINNHUB_API_KEY } = require('../utils/config');

const NEWS_TTL = 5 * 60 * 1000;

async function getNews(symbol) {
  if (!FINNHUB_API_KEY) throw new Error('FINNHUB_API_KEY missing');
  const key = `fhnews:${symbol}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const now = new Date();
  const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
  const resp = await withRetry(() => axios.get(url, { timeout: 8000 }));
  const data = Array.isArray(resp.data) ? resp.data : [];
  cache.set(key, data, NEWS_TTL);
  return data;
}

async function getMarketNews() {
  if (!FINNHUB_API_KEY) throw new Error('FINNHUB_API_KEY missing');
  const key = 'fhnews:general';
  const cached = cache.get(key);
  if (cached) return cached;
  const url = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API_KEY}`;
  const resp = await withRetry(() => axios.get(url, { timeout: 10000 }));
  const data = Array.isArray(resp.data) ? resp.data : [];
  cache.set(key, data, NEWS_TTL);
  return data;
}

module.exports = { name: 'finnhub', getNews, getMarketNews };
