const axios = require('axios');
const eventBus = require('../events/eventBus');
const EVENT_TYPES = require('../events/eventTypes');
const safeProviderCall = require('../system/providerRateLimiter');

const PRIORITY = ['fmp', 'finnhub', 'polygon'];

function providerError(provider, symbol, error) {
  eventBus.emit(EVENT_TYPES.PROVIDER_FAILURE, {
    source: 'provider_router',
    provider,
    symbol,
    severity: 'high',
    issue: 'provider_failover',
    error: error?.message || String(error || 'provider failure'),
    timestamp: new Date().toISOString(),
  });
}

async function fetchFromFmp(symbol) {
  if (!process.env.FMP_API_KEY) throw new Error('FMP_API_KEY missing');
  const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.FMP_API_KEY}`;
  const res = await safeProviderCall(() => axios.get(url, { timeout: 5000 }));
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row || !Number.isFinite(Number(row.price))) throw new Error('fmp invalid payload');
  return { provider: 'fmp', symbol, price: Number(row.price), raw: row };
}

async function fetchFromFinnhub(symbol) {
  if (!process.env.FINNHUB_API_KEY) throw new Error('FINNHUB_API_KEY missing');
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`;
  const res = await safeProviderCall(() => axios.get(url, { timeout: 5000 }));
  const price = Number(res.data?.c);
  if (!Number.isFinite(price)) throw new Error('finnhub invalid payload');
  return { provider: 'finnhub', symbol, price, raw: res.data };
}

async function fetchFromPolygon(symbol) {
  if (!process.env.POLYGON_API_KEY) throw new Error('POLYGON_API_KEY missing');
  const url = `https://api.polygon.io/v2/last/trade/${encodeURIComponent(symbol)}?apiKey=${process.env.POLYGON_API_KEY}`;
  const res = await safeProviderCall(() => axios.get(url, { timeout: 5000 }));
  const price = Number(res.data?.results?.p);
  if (!Number.isFinite(price)) throw new Error('polygon invalid payload');
  return { provider: 'polygon', symbol, price, raw: res.data };
}

const HANDLERS = {
  fmp: fetchFromFmp,
  finnhub: fetchFromFinnhub,
  polygon: fetchFromPolygon,
};

async function getQuoteWithFailover(symbol, preferred) {
  const order = preferred && PRIORITY.includes(preferred)
    ? [preferred, ...PRIORITY.filter((p) => p !== preferred)]
    : PRIORITY;

  for (const provider of order) {
    try {
      return await HANDLERS[provider](symbol);
    } catch (error) {
      providerError(provider, symbol, error);
    }
  }

  throw new Error(`No provider available for ${symbol}`);
}

module.exports = {
  getQuoteWithFailover,
};
