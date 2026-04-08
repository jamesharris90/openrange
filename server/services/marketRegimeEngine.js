'use strict';

/**
 * Market Regime Engine
 *
 * Runs every 5 minutes via cron (same frequency as narrative engine).
 * Computes the current market regime from SPY/VIX data and writes a snapshot
 * to market_regime.  The latest snapshot is held in-process so narrative
 * computations can read it synchronously without hitting the DB.
 *
 * Regime dimensions:
 *   TREND      — BULL / BEAR / RANGE  (SPY vs 20-day and 50-day MA)
 *   VOLATILITY — HIGH / NORMAL / LOW  (VIX: >20 / 15–20 / <15; implied vol fallback)
 *   LIQUIDITY  — HIGH / LOW           (SPY relative_volume vs 1.0 threshold)
 *   SESSION    — PREMARKET / OPEN / MIDDAY / CLOSE / AFTERHOURS  (US ET clock)
 */

const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

// ─── in-process cache ─────────────────────────────────────────────────────────

let _currentRegime = null;
let _regimeCachedAt = null;
const CACHE_TTL_MS = 6 * 60 * 1000; // 6 minutes — slightly longer than 5-min cron

/** Synchronous read used by mcpNarrativeEngine during batch processing. */
function getCurrentRegime() {
  return _currentRegime;
}

// ─── session classification (US Eastern time) ─────────────────────────────────

function getSessionType() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour:     'numeric',
    minute:   'numeric',
    hour12:   false,
  }).formatToParts(new Date());

  const h    = parseInt(parts.find((p) => p.type === 'hour').value,   10);
  const m    = parseInt(parts.find((p) => p.type === 'minute').value, 10);
  const mins = h * 60 + m;

  if (mins >= 240  && mins < 570)  return 'PREMARKET';  // 04:00–09:29
  if (mins >= 570  && mins < 630)  return 'OPEN';        // 09:30–10:29
  if (mins >= 630  && mins < 900)  return 'MIDDAY';      // 10:30–14:59
  if (mins >= 900  && mins < 960)  return 'CLOSE';       // 15:00–15:59
  return 'AFTERHOURS';
}

// ─── trend from SPY MA ────────────────────────────────────────────────────────

function computeTrend(closes, currentPrice) {
  if (closes.length < 10) return 'RANGE'; // not enough data

  const slice = (n) => closes.slice(-n);

  const ma = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const ma20 = ma(slice(Math.min(20, closes.length)));
  const ma50 = ma(slice(Math.min(50, closes.length)));

  const price = currentPrice > 0 ? currentPrice : closes[closes.length - 1];

  let trend;
  if      (price > ma20 && ma20 > ma50) trend = 'BULL';
  else if (price < ma20 && ma20 < ma50) trend = 'BEAR';
  else                                  trend = 'RANGE';

  return { trend, ma20, ma50, price };
}

// ─── implied volatility fallback (annualised daily-return stdev) ──────────────

function impliedVolFromCloses(closes) {
  if (closes.length < 5) return null;
  const returns = closes.slice(-21).map((c, i, arr) =>
    i === 0 ? 0 : (c - arr[i - 1]) / arr[i - 1]
  ).slice(1);
  const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - avg) ** 2, 0) / returns.length;
  return Math.sqrt(variance * 252) * 100;
}

// ─── main regime computation ──────────────────────────────────────────────────

async function computeCurrentRegime() {
  const [spyDailyRes, metricsRes] = await Promise.all([

    // SPY daily history for MA — last 60 trading days
    queryWithTimeout(`
      SELECT close
      FROM daily_ohlc
      WHERE symbol = 'SPY'
        AND date >= CURRENT_DATE - INTERVAL '90 days'
      ORDER BY date ASC
    `, [], { timeoutMs: 10000, label: 'regime.spy_daily', maxRetries: 0 }),

    // Current metrics for SPY and VIX
    queryWithTimeout(`
      SELECT symbol, price, relative_volume
      FROM market_metrics
      WHERE symbol IN ('SPY', 'VIX')
    `, [], { timeoutMs: 5000, label: 'regime.metrics', maxRetries: 0 }),

  ]);

  const metricsMap = {};
  for (const row of metricsRes.rows) metricsMap[row.symbol] = row;

  const closes = spyDailyRes.rows.map((r) => Number(r.close)).filter((v) => v > 0);

  // ── Trend ─────────────────────────────────────────────────────────────────
  const spyCurrentPrice = Number(metricsMap.SPY?.price ?? 0);
  const trendResult     = computeTrend(closes, spyCurrentPrice);
  const { trend, ma20, ma50 } = trendResult;

  // ── Volatility ────────────────────────────────────────────────────────────
  const vixRaw = Number(metricsMap.VIX?.price ?? 0);
  const vixPrice = vixRaw > 0 ? vixRaw : impliedVolFromCloses(closes);

  let volatility;
  if (vixPrice === null)      volatility = 'NORMAL'; // no data — neutral assumption
  else if (vixPrice > 20)    volatility = 'HIGH';
  else if (vixPrice >= 15)   volatility = 'NORMAL';
  else                       volatility = 'LOW';

  // ── Liquidity ─────────────────────────────────────────────────────────────
  const spyRvol  = Number(metricsMap.SPY?.relative_volume ?? 0);
  // rvol ≈ 0 means market is closed or stale — treat as LOW
  const liquidity = spyRvol > 1 ? 'HIGH' : 'LOW';

  // ── Session ───────────────────────────────────────────────────────────────
  const session_type = getSessionType();

  const regime = {
    trend,
    volatility,
    liquidity,
    session_type,
    spy_price:           spyCurrentPrice > 0 ? spyCurrentPrice : (closes.at(-1) ?? null),
    spy_ma20:            ma20   ? Number(ma20.toFixed(2))   : null,
    spy_ma50:            ma50   ? Number(ma50.toFixed(2))   : null,
    vix_price:           vixPrice ? Number(vixPrice.toFixed(2)) : null,
    market_volume_ratio: spyRvol > 0 ? Number(spyRvol.toFixed(3)) : null,
  };

  return regime;
}

// ─── scheduled run: capture + persist ────────────────────────────────────────

async function runRegimeCapture() {
  const t0 = Date.now();

  let regime;
  try {
    regime = await computeCurrentRegime();
  } catch (err) {
    logger.warn('[REGIME] compute failed', { error: err.message });
    return { captured: false };
  }

  // Persist to market_regime
  try {
    await queryWithTimeout(`
      INSERT INTO market_regime
        (trend, volatility, liquidity, session_type,
         spy_price, spy_ma20, spy_ma50, vix_price, market_volume_ratio)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      regime.trend, regime.volatility, regime.liquidity, regime.session_type,
      regime.spy_price, regime.spy_ma20, regime.spy_ma50,
      regime.vix_price, regime.market_volume_ratio,
    ], { timeoutMs: 8000, label: 'regime.insert', maxRetries: 0 });

    // Prune old rows (best-effort)
    queryWithTimeout(
      `SELECT prune_market_regime()`, [],
      { timeoutMs: 5000, label: 'regime.prune', maxRetries: 0 }
    ).catch(() => {});
  } catch (err) {
    logger.warn('[REGIME] persist failed', { error: err.message });
    // Non-fatal: still update in-process cache
  }

  // Update in-process cache
  _currentRegime  = regime;
  _regimeCachedAt = Date.now();

  const durationMs = Date.now() - t0;
  logger.info('[REGIME] captured', {
    trend:      regime.trend,
    volatility: regime.volatility,
    liquidity:  regime.liquidity,
    session:    regime.session_type,
    vix:        regime.vix_price,
    durationMs,
  });

  return { captured: true, regime };
}

// ─── regime narrative for outlook ────────────────────────────────────────────

/**
 * Returns a single narrative line describing the current regime's impact on
 * trade setups.  Appended to the outlook field by mcpNarrativeEngine.
 */
function buildRegimeNarrative(regime) {
  if (!regime) return null;
  const { trend, volatility, session_type } = regime;

  if (session_type === 'PREMARKET') {
    return 'Pre-market session — signals unconfirmed until open; reduce size';
  }
  if (session_type === 'AFTERHOURS') {
    return 'After-hours session — thin liquidity, price action unreliable';
  }

  if (trend === 'BULL' && volatility === 'LOW') {
    return 'Low volatility bull regime — momentum setups favoured, clean follow-through expected';
  }
  if (trend === 'BULL' && volatility === 'NORMAL') {
    return 'Bull trend, normal volatility — continuation setups have historical edge';
  }
  if (trend === 'BULL' && volatility === 'HIGH') {
    return 'High volatility bull regime — trend day conditions, wide ranges expected';
  }
  if (trend === 'BEAR' && volatility === 'HIGH') {
    return 'High volatility bear regime — short bias, avoid long continuation setups';
  }
  if (trend === 'BEAR' && volatility === 'NORMAL') {
    return 'Bear trend — fade rallies, long setups require strong catalyst';
  }
  if (trend === 'BEAR' && volatility === 'LOW') {
    return 'Low volatility bear regime — grinding lower, expect weak follow-through on bounces';
  }
  if (trend === 'RANGE' && volatility === 'HIGH') {
    return 'Choppy high-vol regime — mean reversion only, momentum setups unreliable';
  }
  if (trend === 'RANGE') {
    return 'Range regime — low volatility, mean reversion favoured over momentum';
  }
  return null;
}

/** Compact label for opportunity_stream.regime_context column. */
function regimeLabel(regime) {
  if (!regime) return null;
  return `${regime.trend} / ${regime.volatility} VOL / ${regime.session_type}`;
}

module.exports = {
  runRegimeCapture,
  getCurrentRegime,
  buildRegimeNarrative,
  regimeLabel,
};
