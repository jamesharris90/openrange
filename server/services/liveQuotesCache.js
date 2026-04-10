/**
 * liveQuotesCache.js
 *
 * Batch-fetches FMP /stable/quote for the full stock universe every 3 minutes.
 * Provides changePercent, gapPercent, open, previousClose, volume for screener rows.
 *
 * Usage:
 *   const { getQuote, startLiveQuotesScheduler } = require('./liveQuotesCache');
 *   startLiveQuotesScheduler(symbolsGetter);
 *   const q = getQuote('AAPL'); // { price, changePercent, gapPercent, ... }
 */

const axios = require('axios');

const FMP_BASE = 'https://financialmodelingprep.com';
const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const MAX_AGE_MS = 10 * 60 * 1000;
const BATCH_SIZE = 300;
const BATCH_DELAY_MS = 350;
const REQUEST_TIMEOUT_MS = 20_000;

let _quoteMap = new Map();
let _lastRefreshed = null;
let _refreshing = false;
let _refreshCount = 0;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeQuote(q) {
  if (!q || typeof q !== 'object') return null;

  const price      = toNum(q.price);
  const open       = toNum(q.open);
  const prevClose  = toNum(q.previousClose ?? q.prevClose);
  const changePct  = toNum(q.changesPercentage ?? q.changePercent ?? q.changePercentage);
  const change     = toNum(q.change);
  const volume     = toNum(q.volume);
  const avgVolume  = toNum(q.avgVolume ?? q.avgVolume3m);
  const dayHigh    = toNum(q.dayHigh ?? q.high);
  const dayLow     = toNum(q.dayLow ?? q.low);

  const gapPercent = (open != null && prevClose != null && prevClose !== 0)
    ? ((open - prevClose) / prevClose) * 100
    : null;

  return {
    price,
    open,
    previousClose: prevClose,
    changePercent: changePct,
    changesPercentage: changePct,
    change,
    volume,
    avgVolume,
    dayHigh,
    dayLow,
    gapPercent,
  };
}

async function refreshBatch(symbols, apiKey) {
  const resp = await axios.get(`${FMP_BASE}/stable/quote`, {
    params: { symbol: symbols.join(','), apikey: apiKey },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (resp.status !== 200 || !Array.isArray(resp.data)) return;

  for (const q of resp.data) {
    const sym = String(q?.symbol || '').trim().toUpperCase();
    if (!sym) continue;
    const normalized = normalizeQuote(q);
    if (normalized) _quoteMap.set(sym, normalized);
  }
}

async function refreshQuotes(symbols) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn('[liveQuotesCache] FMP_API_KEY missing — skipping refresh');
    return;
  }

  const unique = Array.from(new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map((s) => String(s || '').trim().toUpperCase())
      .filter(Boolean)
  ));

  if (!unique.length) return;

  _refreshing = true;
  const batches = chunk(unique, BATCH_SIZE);
  const next = new Map();

  // Swap to next map after all batches succeed
  const prevMap = _quoteMap;
  _quoteMap = next;

  for (let i = 0; i < batches.length; i++) {
    try {
      await refreshBatch(batches[i], apiKey);
    } catch (err) {
      console.warn('[liveQuotesCache] batch error', { i, size: batches[i].length, error: err.message });
    }
    if (i < batches.length - 1) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // If refresh produced nothing, revert to previous map
  if (_quoteMap.size === 0) {
    _quoteMap = prevMap;
  } else {
    _lastRefreshed = Date.now();
    _refreshCount++;
    console.log(`[liveQuotesCache] refreshed ${_quoteMap.size} quotes (#${_refreshCount})`);
  }

  _refreshing = false;
}

/**
 * Return cached quote for a symbol, or null.
 */
function getQuote(symbol) {
  if (!symbol) return null;
  return _quoteMap.get(String(symbol).trim().toUpperCase()) ?? null;
}

function getQuoteMap() {
  return _quoteMap;
}

function isFresh() {
  return _lastRefreshed != null && (Date.now() - _lastRefreshed) <= MAX_AGE_MS;
}

function getStats() {
  return {
    count: _quoteMap.size,
    lastRefreshed: _lastRefreshed,
    fresh: isFresh(),
    refreshing: _refreshing,
    refreshCount: _refreshCount,
  };
}

/**
 * Start the background refresh loop.
 * @param {() => Promise<string[]>} getSymbolsFn - async fn returning symbol array
 * @param {object} logger
 */
function startLiveQuotesScheduler(getSymbolsFn, logger = console) {
  const run = async () => {
    if (_refreshing) return;
    try {
      const symbols = await getSymbolsFn();
      if (Array.isArray(symbols) && symbols.length > 0) {
        await refreshQuotes(symbols);
      }
    } catch (err) {
      logger.error('[liveQuotesCache] scheduler run failed', { error: err.message });
    }
  };

  // Kick off immediately
  run();

  setInterval(run, REFRESH_INTERVAL_MS);
  logger.info('[liveQuotesCache] scheduler started', { interval: `${REFRESH_INTERVAL_MS / 1000}s` });
}

module.exports = {
  getQuote,
  getQuoteMap,
  isFresh,
  getStats,
  refreshQuotes,
  startLiveQuotesScheduler,
};
