/**
 * quoteService.js
 *
 * Fetches per-symbol FMP quotes with a global token-bucket rate limiter
 * capped at 5 requests/second (300/minute) — the FMP Starter plan limit.
 *
 * Design:
 *  - 5 concurrent workers, each waits for a token before each HTTP call
 *  - Symbols are pre-sorted by volume (high-volume stocks quoted first)
 *  - Cache is flushed every FLUSH_INTERVAL symbols so screener shows
 *    partial data within ~40 seconds even for 5000-symbol refreshes
 */

const axios = require('axios');
const cacheManager = require('../data-engine/cacheManager');

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const WORKER_COUNT = 5;
const MAX_RETRIES = 3;
const RATE_LIMIT_PER_SEC = 5; // FMP Starter: 300/min = 5/sec
const FLUSH_INTERVAL = 200;   // Write partial results to cache every N symbols

// ---------------------------------------------------------------------------
// Token-bucket global rate limiter
// ---------------------------------------------------------------------------

let _tokens = RATE_LIMIT_PER_SEC;
let _lastRefill = Date.now();

async function consumeToken() {
  const now = Date.now();
  const elapsed = (now - _lastRefill) / 1000;
  _tokens = Math.min(RATE_LIMIT_PER_SEC, _tokens + elapsed * RATE_LIMIT_PER_SEC);
  _lastRefill = now;

  if (_tokens < 1) {
    const waitMs = Math.ceil(((1 - _tokens) / RATE_LIMIT_PER_SEC) * 1000);
    await new Promise((r) => setTimeout(r, waitMs));
    return consumeToken();
  }

  _tokens -= 1;
}

// ---------------------------------------------------------------------------
// API call metrics
// ---------------------------------------------------------------------------

const _metrics = {
  totalCalls: 0,
  callsThisWindow: 0,
  windowStart: Date.now(),
  totalErrors: 0,
  lastRefreshDurationMs: null,
};

function recordApiCall(success = true) {
  _metrics.totalCalls++;
  if (!success) _metrics.totalErrors++;

  const now = Date.now();
  if (now - _metrics.windowStart > 60_000) {
    _metrics.callsThisWindow = 0;
    _metrics.windowStart = now;
  }
  _metrics.callsThisWindow++;

  // Also inform cacheManager's shared metrics
  if (typeof cacheManager.recordApiCall === 'function') {
    cacheManager.recordApiCall();
  }
}

function getApiMetrics() {
  return { ..._metrics };
}

// ---------------------------------------------------------------------------
// Single-symbol fetch
// ---------------------------------------------------------------------------

async function fetchSingleQuote(symbol, apiKey, attempt = 1) {
  await consumeToken();
  const url = `${FMP_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;

  const response = await axios.get(url, { timeout: 15000, validateStatus: () => true });

  if (response.status === 429) {
    recordApiCall(false);
    if (attempt >= MAX_RETRIES) throw new Error(`Rate limited for ${symbol} after ${MAX_RETRIES} retries`);
    const backoff = 250 * 2 ** (attempt - 1);
    await new Promise((r) => setTimeout(r, backoff));
    return fetchSingleQuote(symbol, apiKey, attempt + 1);
  }

  if (response.status !== 200) {
    recordApiCall(false);
    throw new Error(`FMP quote HTTP ${response.status} for ${symbol}`);
  }

  recordApiCall(true);
  const rows = Array.isArray(response.data) ? response.data : [];
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Concurrent quote fetcher with incremental cache flushing
// ---------------------------------------------------------------------------

/**
 * Fetch quotes for a list of symbols.
 * Returns a Map<SYMBOL, quoteRow>.
 * Failed symbols are silently skipped.
 *
 * Flushes partial results to cacheManager every FLUSH_INTERVAL symbols
 * so the screener can serve enriched data before the full fetch completes.
 *
 * @param {string[]} symbols
 * @param {string}   apiKey
 * @param {object}   logger
 * @param {boolean}  flushToCache  - if true, writes partial results to cache (default true)
 * @returns {Promise<Map<string, object>>}
 */
async function fetchQuotesForSymbols(symbols, apiKey, logger = console, flushToCache = false) {
  const cleanSymbols = Array.isArray(symbols)
    ? symbols.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)
    : [];

  if (!cleanSymbols.length) return new Map();

  const startMs = Date.now();
  const quotesMap = new Map();
  let cursor = 0;
  let processed = 0;

  function flushPartialToCache() {
    const existing = cacheManager.getDataset('quotes') || new Map();
    for (const [sym, q] of quotesMap) existing.set(sym, q);
    cacheManager.setDataset('quotes', existing);
    // Rebuild enriched universe so screener shows partial data immediately
    cacheManager.mergeMasterDataset();
    logger.info('quoteService: partial cache flush', {
      quotesStored: existing.size,
      totalSymbols: cleanSymbols.length,
    });
  }

  async function worker() {
    while (cursor < cleanSymbols.length) {
      const idx = cursor++;
      const symbol = cleanSymbols[idx];
      try {
        const quote = await fetchSingleQuote(symbol, apiKey);
        if (quote) quotesMap.set(symbol, quote);
      } catch (err) {
        logger.warn(`quoteService: failed to fetch ${symbol}: ${err.message}`);
      }

      processed++;

      // Flush partial results at each interval boundary
      if (flushToCache && processed % FLUSH_INTERVAL === 0) {
        flushPartialToCache();
      }
    }
  }

  const workerCount = Math.min(WORKER_COUNT, cleanSymbols.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  _metrics.lastRefreshDurationMs = Date.now() - startMs;

  logger.info('quoteService: refresh complete', {
    requested: cleanSymbols.length,
    received: quotesMap.size,
    durationMs: _metrics.lastRefreshDurationMs,
  });

  return quotesMap;
}

// ---------------------------------------------------------------------------
// Preset + watchlist quote refresh
// ---------------------------------------------------------------------------

/**
 * Refresh quote data in cacheManager for preset + watchlist symbols.
 *
 * Symbols are sorted by volume descending so the most-traded stocks
 * get quotes first — the screener shows useful data within ~40 seconds.
 *
 * @param {string[]} presetSymbols    - symbols from active preset universe
 * @param {string[]} watchlistSymbols - watchlist symbols (higher priority)
 * @param {string}   apiKey
 * @param {object}   logger
 */
async function refreshPresetQuotes(presetSymbols, watchlistSymbols, apiKey, logger = console) {
  // Build priority-ordered list: watchlist first, then preset sorted by volume
  const watchSet = new Set(watchlistSymbols.map((s) => s.toUpperCase()));

  // Sort preset symbols by volume descending using base universe data
  const baseUniverse = cacheManager.getBaseUniverse();
  const volumeBySymbol = new Map(
    baseUniverse.map((r) => [r.symbol, typeof r.volume === 'number' ? r.volume : 0])
  );

  const sortedPreset = presetSymbols
    .map((s) => s.toUpperCase())
    .filter((s) => !watchSet.has(s))
    .sort((a, b) => (volumeBySymbol.get(b) || 0) - (volumeBySymbol.get(a) || 0));

  const allSymbols = [
    ...watchlistSymbols.map((s) => s.toUpperCase()),
    ...sortedPreset,
  ];

  logger.info('quoteService: starting quote refresh', {
    total: allSymbols.length,
    watchlist: watchlistSymbols.length,
    estimatedMinutes: Math.ceil(allSymbols.length / (RATE_LIMIT_PER_SEC * 60)),
  });

  // Fetch with incremental cache flushing enabled
  const quotesMap = await fetchQuotesForSymbols(allSymbols, apiKey, logger, true);

  // Final flush (captures remaining symbols not yet flushed)
  const existing = cacheManager.getDataset('quotes') || new Map();
  for (const [sym, quote] of quotesMap) {
    existing.set(sym, quote);
  }
  cacheManager.setDataset('quotes', existing);

  logger.info('quoteService: quote refresh complete', {
    received: quotesMap.size,
    totalInCache: existing.size,
  });

  return quotesMap;
}

module.exports = {
  fetchQuotesForSymbols,
  refreshPresetQuotes,
  getApiMetrics,
};
