/**
 * spyStateEngine.js
 *
 * Fetches SPY + VIX context via Yahoo Finance every 5 minutes.
 * Provides market bias (-5 to +5), VIX decile (1–10), and session info.
 * Runs independently of the enrichment pipeline.
 *
 * Exported state is used by screenerV3 to populate the `environment` field
 * and to warp filter thresholds via filterEngine.warpFilters().
 */

const YahooFinance = require('yahoo-finance2').default;
const { mapToProviderSymbol } = require('../utils/symbolMap');

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// ---------------------------------------------------------------------------
// Phase detection (UK timezone)
// ---------------------------------------------------------------------------

function getUKMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

function getSession() {
  const min = getUKMinutes();
  if (min < 11 * 60 + 30) return 'overnight';
  if (min < 13 * 60)      return 'prescan';
  if (min < 14 * 60 + 30) return 'watchlist';
  if (min < 15 * 60)      return 'open-acceleration';
  return 'post-open';
}

// ---------------------------------------------------------------------------
// Bias computation
// ---------------------------------------------------------------------------

function computeBias(spyChangePct, vixDecile) {
  let bias = 0;

  // SPY direction contribution
  if      (spyChangePct >  2.0)  bias += 3;
  else if (spyChangePct >  1.0)  bias += 2;
  else if (spyChangePct >  0.3)  bias += 1;
  else if (spyChangePct < -2.0)  bias -= 3;
  else if (spyChangePct < -1.0)  bias -= 2;
  else if (spyChangePct < -0.3)  bias -= 1;

  // VIX regime adjustment
  if      (vixDecile >= 8) bias -= 1; // high vol → cautious
  else if (vixDecile <= 3) bias += 1; // low vol → slight bull lean

  return Math.max(-5, Math.min(5, Math.round(bias)));
}

/**
 * Convert a raw VIX level to a decile (1–10) within its 52-week range.
 */
function computeVixDecile(currentVix, vixHistory) {
  if (!currentVix || !vixHistory.length) return 5; // neutral default

  const sorted = [...vixHistory].sort((a, b) => a - b);
  const min    = sorted[0];
  const max    = sorted[sorted.length - 1];
  if (max === min) return 5;

  const position = (currentVix - min) / (max - min); // 0–1
  return Math.min(10, Math.max(1, Math.ceil(position * 10)));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Default neutral state — used until first real fetch succeeds. */
let _state = {
  spyChangePercent: 0,
  spyPrice: null,
  spyAboveVwap: null,
  vixLevel: null,
  vixDecile: 5,
  bias: 0,
  session: getSession(),
  updatedAt: null,
};

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

/**
 * Fetch fresh SPY + VIX data and update the module-level state.
 * Throws on unrecoverable errors; caller should catch and log.
 */
async function refreshSpyState(logger = console) {
  const vixProviderSymbol = mapToProviderSymbol('VIX');
  const [spyQuote, vixQuote] = await Promise.all([
    yf.quote('SPY',  {}, { validateResult: false }),
    yf.quote(vixProviderSymbol, {}, { validateResult: false }),
  ]);

  const spyChangePct = spyQuote?.regularMarketChangePercent ?? 0;
  const spyPrice     = spyQuote?.regularMarketPrice         ?? null;
  const vixLevel     = vixQuote?.regularMarketPrice         ?? null;

  // Fetch 52-week VIX history for decile calculation
  let vixDecile = 5;
  try {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const vixChart   = await yf.chart(vixProviderSymbol, { period1: oneYearAgo, period2: new Date(), interval: '1d' }, { validateResult: false });
    const closes     = (vixChart?.quotes || []).map((q) => q.close).filter(Number.isFinite);
    vixDecile = computeVixDecile(vixLevel, closes);
  } catch (err) {
    logger.warn('spyStateEngine: VIX history fetch failed, using default decile', { error: err.message });
  }

  const bias    = computeBias(spyChangePct, vixDecile);
  const session = getSession();

  _state = {
    spyChangePercent: spyChangePct,
    spyPrice,
    spyAboveVwap: null, // Could be derived from intraday VWAP; omit for now
    vixLevel,
    vixDecile,
    bias,
    session,
    updatedAt: new Date().toISOString(),
  };

  logger.info('spyStateEngine: refreshed', { spyChangePct, vixLevel, vixDecile, bias, session });
  return _state;
}

/**
 * Return the last-known SPY state object synchronously.
 * Returns the default neutral state if refreshSpyState() has not been called.
 */
function getSpyState() {
  // Always update the session field to reflect current time
  return { ..._state, session: getSession() };
}

module.exports = { refreshSpyState, getSpyState };
