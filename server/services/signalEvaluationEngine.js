'use strict';

/**
 * Signal Evaluation Engine
 *
 * Tracks every trade signal written by mcpNarrativeEngine and measures
 * real-world outcome against intraday price data.
 *
 * Runs on a 10-minute cron:
 *   1. Fetch unevaluated signal_outcomes (5m+ old, entry_price > 0)
 *   2. Pull intraday_1m candles for each symbol
 *   3. Compute price_after_5m, price_after_15m, price_after_1h
 *   4. Compute max_upside_pct, max_drawdown_pct over 1h window
 *   5. Classify WIN / LOSS / NEUTRAL via R-multiple rules
 *   6. Batch-update in one SQL round-trip
 *
 * Performance cache (refreshed every 30 min):
 *   Aggregates win_rate, avg_upside by setup_type + consequence pattern.
 *   Used by mcpNarrativeEngine to adjust confidence scores.
 */

const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

// ─── in-memory performance cache ─────────────────────────────────────────────
//
// Two-level structure:
//   _perfGlobal  : "setup_type|consequence"                  → stats (all regimes)
//   _perfByRegime: "setup_type|consequence|trend|volatility" → stats (regime-specific)
//
// Regime-specific stats are used first; global stats are the fallback.

let _perfGlobal   = {};
let _perfByRegime = {};
let _cacheLoadedAt = null;

function _buildStats(row) {
  const total = Number(row.total);
  const wins  = Number(row.wins);
  return {
    total,
    wins,
    losses:       Number(row.losses),
    win_rate:     total > 0 ? wins / total : 0.5,
    avg_upside:   Number(row.avg_upside   || 0),
    avg_drawdown: Number(row.avg_drawdown || 0),
    avg_win:      Number(row.avg_win  || 0),
    avg_loss:     Number(row.avg_loss || 0),
  };
}

/**
 * Look up performance stats.
 * If regime_trend + regime_volatility are supplied, returns regime-specific stats
 * (falling back to global if the regime bucket has fewer than 5 signals).
 */
function getPerformanceStats(setup_type, consequence, regime_trend, regime_volatility) {
  const base = `${setup_type || 'UNKNOWN'}|${consequence || 'unknown'}`;

  if (regime_trend && regime_volatility) {
    const regimeKey = `${base}|${regime_trend}|${regime_volatility}`;
    if (_perfByRegime[regimeKey]) return _perfByRegime[regimeKey];
  }

  return _perfGlobal[base] || null;
}

/**
 * Return the regime label with the highest win rate for a given setup+consequence pattern.
 * Requires at least 10 evaluated signals.
 * Returns a human-readable string like "BULL trend + HIGH vol", or null.
 */
function getBestRegimeForSetup(setup_type, consequence) {
  const base   = `${setup_type || 'UNKNOWN'}|${consequence || 'unknown'}`;
  let bestKey  = null;
  let bestRate = 0;

  for (const [key, stats] of Object.entries(_perfByRegime)) {
    if (!key.startsWith(base + '|')) continue;
    if (stats.total < 10) continue;
    if (stats.win_rate > bestRate) {
      bestRate = stats.win_rate;
      bestKey  = key;
    }
  }

  if (!bestKey) return null;

  const parts = bestKey.split('|');
  const trend = parts[2];
  const vol   = parts[3];
  return `${trend} trend + ${vol} vol`;
}

/**
 * Rebuild both performance caches from signal_outcomes.
 * Minimum 5 evaluated signals per pattern before it enters either cache.
 */
async function refreshPerformanceCache() {
  try {
    const [globalRes, regimeRes] = await Promise.all([

      // Global: group by setup + consequence only
      queryWithTimeout(`
        SELECT
          COALESCE(setup_type, 'UNKNOWN')  AS setup_type,
          COALESCE(consequence, 'unknown') AS consequence,
          COUNT(*)::int                    AS total,
          SUM(CASE WHEN outcome = 'WIN'  THEN 1 ELSE 0 END)::int AS wins,
          SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END)::int AS losses,
          ROUND(AVG(max_upside_pct)::numeric,   3) AS avg_upside,
          ROUND(AVG(max_drawdown_pct)::numeric, 3) AS avg_drawdown,
          ROUND(AVG(CASE WHEN outcome = 'WIN'  THEN max_upside_pct  END)::numeric, 3) AS avg_win,
          ROUND(AVG(CASE WHEN outcome = 'LOSS' THEN max_drawdown_pct END)::numeric, 3) AS avg_loss
        FROM signal_outcomes
        WHERE outcome IS NOT NULL AND entry_price > 0
          AND created_at > NOW() - INTERVAL '90 days'
        GROUP BY setup_type, consequence
        HAVING COUNT(*) >= 5
      `, [], { timeoutMs: 15000, label: 'signal_eval.perf_global', maxRetries: 0 }),

      // Regime-split: group by setup + consequence + trend + volatility
      queryWithTimeout(`
        SELECT
          COALESCE(setup_type, 'UNKNOWN')       AS setup_type,
          COALESCE(consequence, 'unknown')      AS consequence,
          COALESCE(regime_trend, 'UNKNOWN')     AS regime_trend,
          COALESCE(regime_volatility, 'UNKNOWN') AS regime_volatility,
          COUNT(*)::int                         AS total,
          SUM(CASE WHEN outcome = 'WIN'  THEN 1 ELSE 0 END)::int AS wins,
          SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END)::int AS losses,
          ROUND(AVG(max_upside_pct)::numeric,   3) AS avg_upside,
          ROUND(AVG(max_drawdown_pct)::numeric, 3) AS avg_drawdown,
          ROUND(AVG(CASE WHEN outcome = 'WIN'  THEN max_upside_pct  END)::numeric, 3) AS avg_win,
          ROUND(AVG(CASE WHEN outcome = 'LOSS' THEN max_drawdown_pct END)::numeric, 3) AS avg_loss
        FROM signal_outcomes
        WHERE outcome IS NOT NULL AND entry_price > 0
          AND created_at > NOW() - INTERVAL '90 days'
          AND regime_trend IS NOT NULL
        GROUP BY setup_type, consequence, regime_trend, regime_volatility
        HAVING COUNT(*) >= 5
      `, [], { timeoutMs: 15000, label: 'signal_eval.perf_regime', maxRetries: 0 }),
    ]);

    const newGlobal = {};
    for (const row of globalRes.rows) {
      newGlobal[`${row.setup_type}|${row.consequence}`] = _buildStats(row);
    }

    const newByRegime = {};
    for (const row of regimeRes.rows) {
      const key = `${row.setup_type}|${row.consequence}|${row.regime_trend}|${row.regime_volatility}`;
      newByRegime[key] = _buildStats(row);
    }

    _perfGlobal    = newGlobal;
    _perfByRegime  = newByRegime;
    _cacheLoadedAt = Date.now();

    const global  = Object.keys(newGlobal).length;
    const regime  = Object.keys(newByRegime).length;
    logger.info('[SIGNAL EVAL] performance cache refreshed', { global, regime });
    return { global, regime };
  } catch (err) {
    logger.warn('[SIGNAL EVAL] cache refresh failed', { error: err.message });
    return { global: 0, regime: 0 };
  }
}

// ─── signal evaluation ────────────────────────────────────────────────────────

async function runSignalEvaluation() {
  const t0 = Date.now();

  // Fetch pending signals: at least 6 minutes old (5m window + 1m buffer)
  let pending;
  try {
    const { rows } = await queryWithTimeout(`
      SELECT id, symbol, signal_ts, entry_price, expected_move_pct
      FROM signal_outcomes
      WHERE price_after_5m IS NULL
        AND signal_ts < NOW() - INTERVAL '6 minutes'
        AND entry_price > 0
      ORDER BY signal_ts ASC
      LIMIT 300
    `, [], { timeoutMs: 15000, label: 'signal_eval.pending', maxRetries: 0 });
    pending = rows;
  } catch (err) {
    logger.warn('[SIGNAL EVAL] fetch pending failed', { error: err.message });
    return { evaluated: 0 };
  }

  if (pending.length === 0) {
    logger.info('[SIGNAL EVAL] no pending signals');
    return { evaluated: 0 };
  }

  // Group by symbol to share candle fetch
  const bySymbol = {};
  for (const sig of pending) {
    if (!bySymbol[sig.symbol]) bySymbol[sig.symbol] = [];
    bySymbol[sig.symbol].push(sig);
  }

  const updates = [];

  await Promise.all(
    Object.entries(bySymbol).map(async ([symbol, signals]) => {
      const earliest = new Date(
        Math.min(...signals.map((s) => new Date(s.signal_ts).getTime()))
      );

      let candles;
      try {
        const { rows } = await queryWithTimeout(`
          SELECT "timestamp", high, low, close
          FROM intraday_1m
          WHERE symbol = $1
            AND "timestamp" >= $2
            AND "timestamp" <= NOW()
          ORDER BY "timestamp" ASC
        `, [symbol, earliest], {
          timeoutMs: 10000,
          label:     `signal_eval.candles.${symbol}`,
          maxRetries: 0,
        });
        candles = rows;
      } catch {
        return; // skip symbol on error — will retry next cycle
      }

      if (candles.length === 0) return;

      for (const sig of signals) {
        const sigTs  = new Date(sig.signal_ts).getTime();
        const entry  = Number(sig.entry_price);
        if (!entry || entry <= 0) continue;

        const ts5m  = sigTs + 5  * 60_000;
        const ts15m = sigTs + 15 * 60_000;
        const ts1h  = sigTs + 60 * 60_000;

        const after = (minTs) =>
          candles.find((c) => new Date(c.timestamp).getTime() >= minTs);

        const c5m  = after(ts5m);
        const c15m = after(ts15m);
        const c1h  = after(ts1h);

        // Max upside/drawdown over the 1-hour evaluation window
        const window = candles.filter((c) => {
          const t = new Date(c.timestamp).getTime();
          return t >= sigTs && t <= ts1h;
        });

        let maxUpside = null;
        let maxDrawdown = null;

        if (window.length > 0) {
          const maxHigh = Math.max(...window.map((c) => Number(c.high)));
          const minLow  = Math.min(...window.map((c) => Number(c.low)));
          maxUpside   = ((maxHigh - entry) / entry) * 100;
          maxDrawdown = ((minLow  - entry) / entry) * 100;
        }

        // R = half the expected daily move; default to 1% if unknown
        const R = Number(sig.expected_move_pct) > 0
          ? Number(sig.expected_move_pct) / 2
          : 1;

        let outcome = null;
        if (maxUpside !== null && maxDrawdown !== null) {
          if      (maxUpside  >= 2 * R) outcome = 'WIN';
          else if (maxDrawdown <= -R)   outcome = 'LOSS';
          else                          outcome = 'NEUTRAL';
        }

        updates.push({
          id:               String(sig.id),
          p5m:              c5m  ? String(Number(c5m.close).toFixed(4))  : null,
          p15m:             c15m ? String(Number(c15m.close).toFixed(4)) : null,
          p1h:              c1h  ? String(Number(c1h.close).toFixed(4))  : null,
          max_upside_pct:   maxUpside   !== null ? String(maxUpside.toFixed(4))   : null,
          max_drawdown_pct: maxDrawdown !== null ? String(maxDrawdown.toFixed(4)) : null,
          outcome,
        });
      }
    })
  );

  if (updates.length === 0) {
    logger.info('[SIGNAL EVAL] no candle data yet for pending signals');
    return { evaluated: 0 };
  }

  // Single batch UPDATE
  const sql = `
    UPDATE signal_outcomes so
    SET price_after_5m   = r.p5m::numeric,
        price_after_15m  = r.p15m::numeric,
        price_after_1h   = r.p1h::numeric,
        max_upside_pct   = r.max_upside_pct::numeric,
        max_drawdown_pct = r.max_drawdown_pct::numeric,
        outcome          = r.outcome
    FROM json_to_recordset($1::json) AS r(
      id               text,
      p5m              text,
      p15m             text,
      p1h              text,
      max_upside_pct   text,
      max_drawdown_pct text,
      outcome          text
    )
    WHERE so.id::text = r.id
      AND r.outcome IS NOT NULL
  `;

  try {
    await queryWithTimeout(sql, [JSON.stringify(updates)], {
      timeoutMs: 30000,
      label:     'signal_eval.batch_update',
      maxRetries: 0,
    });
  } catch (err) {
    logger.warn('[SIGNAL EVAL] batch update failed', { error: err.message });
    return { evaluated: 0 };
  }

  const durationMs = Date.now() - t0;
  logger.info('[SIGNAL EVAL] complete', { evaluated: updates.length, durationMs });
  return { evaluated: updates.length };
}

// ─── performance stats API ────────────────────────────────────────────────────

/**
 * Returns a human-readable performance note for the UI.
 * Regime-specific stats are used when available; falls back to global.
 * Requires at least 10 evaluated signals for the pattern before returning.
 *
 * Example:
 *   "Win rate: 64% (last 120 signals) / Avg move: +1.8%
 *    Works best in: BULL trend + LOW vol / Current regime: RANGE / HIGH VOL / MIDDAY"
 */
function buildPerformanceNote(setup_type, consequence, regime) {
  const trend = regime?.trend        || null;
  const vol   = regime?.volatility   || null;

  const stats = getPerformanceStats(setup_type, consequence, trend, vol);
  if (!stats || stats.total < 10) return null;

  const winPct  = Math.round(stats.win_rate * 100);
  const avgMove = stats.avg_upside > 0
    ? `+${stats.avg_upside.toFixed(1)}%`
    : `${stats.avg_upside.toFixed(1)}%`;

  const lines = [
    `Win rate: ${winPct}% (last ${stats.total} signals) / Avg move: ${avgMove}`,
  ];

  const bestRegime = getBestRegimeForSetup(setup_type, consequence);
  if (bestRegime) {
    lines.push(`Works best in: ${bestRegime}`);
  }

  if (regime) {
    lines.push(`Current regime: ${regime.trend} trend + ${regime.volatility} vol`);
  }

  return lines.join(' / ');
}

/**
 * Adjust base confidence by historical win rate for this setup+consequence+regime pattern.
 * Uses regime-specific stats first, falls back to global.
 * Scales linearly: 50% win rate = no change; 70% = +8pts; 30% = -8pts (max ±20).
 * Requires at least 10 evaluated signals before any adjustment is applied.
 */
function adjustConfidenceByPerformance(baseConfidence, setup_type, consequence, regime_trend, regime_volatility) {
  const stats = getPerformanceStats(setup_type, consequence, regime_trend, regime_volatility);
  if (!stats || stats.total < 10) return baseConfidence;

  // Linear adjustment: (win_rate - 0.5) maps -0.5→+0.5 to -20→+20 pts
  const adjustment = Math.round((stats.win_rate - 0.5) * 40);
  return Math.max(0, Math.min(100, baseConfidence + adjustment));
}

module.exports = {
  runSignalEvaluation,
  refreshPerformanceCache,
  getPerformanceStats,
  getBestRegimeForSetup,
  buildPerformanceNote,
  adjustConfidenceByPerformance,
};
