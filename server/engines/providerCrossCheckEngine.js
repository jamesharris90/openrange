const axios = require('axios');
const EVENT_TYPES = require('../events/eventTypes');
const eventBus = require('../events/eventBus');
const logger = require('../logger');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctDiff(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return 0;
  return Math.abs((a - b) / a) * 100;
}

async function fetchFmpPrice(symbol) {
  if (!process.env.FMP_API_KEY) return null;
  const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.FMP_API_KEY}`;
  const res = await axios.get(url, { timeout: 6000 });
  const row = Array.isArray(res.data) ? res.data[0] : null;
  return toNum(row?.price);
}

async function fetchFinnhubPrice(symbol) {
  if (!process.env.FINNHUB_API_KEY) return null;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`;
  const res = await axios.get(url, { timeout: 6000 });
  return toNum(res.data?.c);
}

async function fetchPolygonPrice(symbol) {
  if (!process.env.POLYGON_API_KEY) return null;
  const url = `https://api.polygon.io/v2/last/trade/${encodeURIComponent(symbol)}?apiKey=${process.env.POLYGON_API_KEY}`;
  const res = await axios.get(url, { timeout: 6000 });
  return toNum(res.data?.results?.p);
}

async function runProviderCrossCheckEngine(symbol = 'AAPL') {
  const startedAt = Date.now();
  const providerPrices = {
    fmp: null,
    finnhub: null,
    polygon: null,
  };

  try {
    const [fmp, finnhub, polygon] = await Promise.allSettled([
      fetchFmpPrice(symbol),
      fetchFinnhubPrice(symbol),
      fetchPolygonPrice(symbol),
    ]);

    providerPrices.fmp = fmp.status === 'fulfilled' ? fmp.value : null;
    providerPrices.finnhub = finnhub.status === 'fulfilled' ? finnhub.value : null;
    providerPrices.polygon = polygon.status === 'fulfilled' ? polygon.value : null;

    const values = Object.values(providerPrices).filter((v) => Number.isFinite(v));
    if (values.length < 2) {
      return {
        ok: true,
        symbol,
        provider_prices: providerPrices,
        discrepancies: [],
        execution_time_ms: Date.now() - startedAt,
        last_run: new Date().toISOString(),
      };
    }

    const baseline = values.reduce((sum, n) => sum + n, 0) / values.length;
    const discrepancies = [];

    for (const [provider, price] of Object.entries(providerPrices)) {
      if (!Number.isFinite(price)) continue;
      const diff = pctDiff(baseline, price);
      if (diff > 2) {
        const payload = {
          source: 'provider_crosscheck_engine',
          symbol,
          provider,
          price,
          baseline_price: Number(baseline.toFixed(4)),
          diff_percent: Number(diff.toFixed(3)),
          issue: 'provider_price_discrepancy',
          severity: diff > 5 ? 'high' : 'medium',
          timestamp: new Date().toISOString(),
        };
        discrepancies.push(payload);
        eventBus.emit(EVENT_TYPES.PROVIDER_DISCREPANCY, payload);
        eventBus.emit(EVENT_TYPES.DATA_INTEGRITY_WARNING, payload);
      }
    }

    return {
      ok: true,
      symbol,
      provider_prices: providerPrices,
      discrepancies,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('[ENGINE ERROR] provider_crosscheck_engine failed', { error: error.message });
    eventBus.emit(EVENT_TYPES.PROVIDER_FAILURE, {
      source: 'provider_crosscheck_engine',
      provider: 'multiple',
      symbol,
      issue: 'crosscheck_engine_failure',
      severity: 'high',
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    return {
      ok: false,
      symbol,
      provider_prices: providerPrices,
      discrepancies: [],
      error: error.message,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
    };
  }
}

module.exports = {
  runProviderCrossCheckEngine,
};
