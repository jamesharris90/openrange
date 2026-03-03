/**
 * yahooHistoricalEnricher.js  — Layer B2
 *
 * Fetches per-symbol historical data from Yahoo Finance (yahoo-finance2 v3):
 *   - 90-day daily OHLCV  → closeSeries / bars for technicalCalculator
 *   - yf.quote()          → floatShares, avgVolume30d
 *   - intraday 1-min bars → VWAP, openingRangeHigh/Low (during market hours)
 *
 * Rate limiting: 5 concurrent workers, 250ms inter-symbol delay.
 * Cache: daily data 24h TTL, intraday 30min TTL.
 */

const YahooFinance = require('yahoo-finance2').default;

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const DAILY_TTL_MS    = 24 * 60 * 60 * 1000;
const INTRADAY_TTL_MS = 30 * 60 * 1000;
const WORKER_COUNT    = 5;
const CALL_DELAY_MS   = 250;

const _dailyCache    = new Map(); // symbol → { ts, data }
const _intradayCache = new Map(); // symbol → { ts, data }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Return the UTC timestamp for today's US market open (09:30 ET),
 * correctly handling EDT (UTC-4) vs EST (UTC-5).
 */
function getMarketOpenUTC() {
  const now = new Date();
  // Reference noon UTC — check what hour it is in ET to derive offset
  const noonUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));
  const noonET  = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(noonUTC),
    10,
  );
  const etOffsetHours = 12 - noonET; // 4 = EDT, 5 = EST

  const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now); // 'YYYY-MM-DD'
  const [year, month, day] = etDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 9 + etOffsetHours, 30, 0));
}

/**
 * Compute VWAP from an array of {h, l, c, v} bar objects.
 */
function computeVWAP(bars) {
  let num = 0;
  let den = 0;
  for (const b of bars) {
    if (!b.h || !b.l || !b.c || !b.v) continue;
    const tp = (b.h + b.l + b.c) / 3;
    num += tp * b.v;
    den += b.v;
  }
  return den > 0 ? num / den : null;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchDailyBars(symbol) {
  const now     = new Date();
  const period1 = new Date(now.valueOf() - 90 * 24 * 60 * 60 * 1000);
  const result  = await yf.chart(symbol, { period1, period2: now, interval: '1d' }, { validateResult: false });
  const quotes  = result?.quotes || [];
  return {
    closeSeries:  quotes.map((q) => q.adjclose ?? q.close).filter(Number.isFinite),
    highSeries:   quotes.map((q) => q.high).filter(Number.isFinite),
    lowSeries:    quotes.map((q) => q.low).filter(Number.isFinite),
    volumeSeries: quotes.map((q) => q.volume).filter(Number.isFinite),
    // Daily bars for atr/range calculations (use daily OHLCV)
    dailyBars: quotes.map((q) => ({
      t: q.date,
      o: q.open,
      h: q.high,
      l: q.low,
      c: q.adjclose ?? q.close,
      v: q.volume,
    })).filter((b) => b.h && b.l && b.c),
  };
}

async function fetchQuoteSummary(symbol) {
  const result = await yf.quote(symbol, {}, { validateResult: false });
  return {
    floatShares: result?.sharesFloat   ?? null,
    avgVolume30d: result?.averageVolume ?? null,
  };
}

async function fetchIntradayBars(symbol) {
  const now        = new Date();
  const marketOpen = getMarketOpenUTC();
  if (now < marketOpen) return null; // market not yet open today

  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const result     = await yf.chart(symbol, { period1: todayStart, period2: now, interval: '1m' }, { validateResult: false });
  const quotes     = result?.quotes || [];

  const marketBars = quotes
    .filter((q) => q.date >= marketOpen && q.volume > 0)
    .map((q) => ({ t: q.date, o: q.open, h: q.high, l: q.low, c: q.close, v: q.volume }));

  if (!marketBars.length) return null;

  const openingBars      = marketBars.slice(0, 30);
  const openingRangeHigh = openingBars.length ? Math.max(...openingBars.map((b) => b.h)) : null;
  const openingRangeLow  = openingBars.length ? Math.min(...openingBars.map((b) => b.l)) : null;
  const vwap             = computeVWAP(marketBars);

  return { bars: marketBars, vwap, openingRangeHigh, openingRangeLow };
}

// ---------------------------------------------------------------------------
// Per-symbol enrichment (with cache)
// ---------------------------------------------------------------------------

async function enrichSingleSymbol(symbol) {
  const now = Date.now();

  const dailyCached    = _dailyCache.get(symbol);
  const intradayCached = _intradayCache.get(symbol);
  const dailyFresh     = dailyCached    && (now - dailyCached.ts)    < DAILY_TTL_MS;
  const intradayFresh  = intradayCached && (now - intradayCached.ts) < INTRADAY_TTL_MS;

  let dailyData    = dailyFresh    ? dailyCached.data    : null;
  let intradayData = intradayFresh ? intradayCached.data : null;

  if (!dailyFresh) {
    // Fetch daily bars and quote summary sequentially to avoid burst
    const daily = await fetchDailyBars(symbol);
    await sleep(CALL_DELAY_MS);
    const quote = await fetchQuoteSummary(symbol);
    dailyData = { ...daily, ...quote };
    _dailyCache.set(symbol, { ts: now, data: dailyData });
    await sleep(CALL_DELAY_MS);
  }

  if (!intradayFresh) {
    const intraday = await fetchIntradayBars(symbol);
    if (intraday) {
      intradayData = intraday;
      _intradayCache.set(symbol, { ts: now, data: intradayData });
    }
    await sleep(CALL_DELAY_MS);
  }

  return {
    closeSeries:       dailyData?.closeSeries   || [],
    highSeries:        dailyData?.highSeries    || [],
    lowSeries:         dailyData?.lowSeries     || [],
    volumeSeries:      dailyData?.volumeSeries  || [],
    bars:              intradayData?.bars       || dailyData?.dailyBars || [],
    floatShares:       dailyData?.floatShares   ?? null,
    avgVolume30d:      dailyData?.avgVolume30d  ?? null,
    openingRangeHigh:  intradayData?.openingRangeHigh ?? null,
    openingRangeLow:   intradayData?.openingRangeLow  ?? null,
    vwap:              intradayData?.vwap               ?? null,
  };
}

// ---------------------------------------------------------------------------
// Batch enricher
// ---------------------------------------------------------------------------

/**
 * Enrich a list of symbols with historical Yahoo Finance data.
 * Returns Map<symbol, historicalData>.
 */
async function enrichHistorical(symbols, logger = console) {
  const cleanSymbols = (Array.isArray(symbols) ? symbols : [])
    .map((s) => String(s || '').trim().toUpperCase())
    .filter(Boolean);

  if (!cleanSymbols.length) return new Map();

  const startMs  = Date.now();
  const out      = new Map();
  let cursor     = 0;
  let succeeded  = 0;
  let failed     = 0;

  async function worker() {
    while (cursor < cleanSymbols.length) {
      const idx    = cursor++;
      const symbol = cleanSymbols[idx];
      try {
        const data = await enrichSingleSymbol(symbol);
        out.set(symbol, data);
        succeeded++;
      } catch (err) {
        failed++;
        logger.warn(`yahooHistoricalEnricher: failed ${symbol}: ${err.message}`);
      }
    }
  }

  const workerCount = Math.min(WORKER_COUNT, cleanSymbols.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  logger.info('yahooHistoricalEnricher: complete', {
    requested: cleanSymbols.length,
    succeeded,
    failed,
    durationMs: Date.now() - startMs,
  });

  return out;
}

/**
 * Invalidate intraday cache for all symbols (call at market open to force fresh intraday bars).
 */
function clearIntradayCache() {
  _intradayCache.clear();
}

module.exports = { enrichHistorical, clearIntradayCache };
