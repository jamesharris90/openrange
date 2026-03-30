'use strict';

/**
 * Execution Refinement Engine
 *
 * Runs every 10 minutes AFTER executionEngine.
 * Adds confirmation, session timing, breakout validation, and adaptive
 * trade management on top of the base execution plan already stored in
 * premarket_watchlist.
 *
 * Phases covered:
 *   2  — Session phase detection (ET-aware)
 *   3  — Breakout confirmation from last 3 intraday candles
 *   4  — Breakout strength (volume ratio 0–5 scale)
 *   5  — False breakout filter
 *   6  — Adaptive stop: MAX(pm_low, entry - ATR*0.75)
 *   7  — Adaptive target: ATR multiplier driven by breakout strength + confidence
 *   8  — Session-based validity filter
 *   9  — Execution rating: ELITE / GOOD / WATCH / AVOID
 *  10  — Execution notes (deterministic text per rating)
 *  11  — Signal log upgrade (entry_confirmed, breakout_strength, execution_rating)
 *
 * STRICT RULES:
 *   - No random thresholds
 *   - All logic derived from intraday_1m and premarket_watchlist data
 *   - Degrade gracefully when confirmation data is missing
 */

const { queryWithTimeout } = require('../db/pg');

const ENGINE_LABEL       = '[EXEC_REFINE]';
const INTER_SYMBOL_DELAY = 150;

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Session phase (ET-aware)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the current US Eastern Time session phase.
 * Boundaries (ET):
 *   < 09:30         → PREMARKET
 *   09:30 – 10:00   → OPEN
 *   10:00 – 14:30   → MIDDAY
 *   14:30 – 16:00   → CLOSE
 *   ≥ 16:00         → AFTERHOURS
 */
function getSessionPhase() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());

    const h = parseInt(parts.find(p => p.type === 'hour')?.value   ?? '0', 10);
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    const totalMin = h * 60 + m;

    if (totalMin < 9 * 60 + 30)  return 'PREMARKET';
    if (totalMin < 10 * 60)      return 'OPEN';
    if (totalMin < 14 * 60 + 30) return 'MIDDAY';
    if (totalMin < 16 * 60)      return 'CLOSE';
    return 'AFTERHOURS';
  } catch (_) {
    return 'UNKNOWN';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 & 4 — Fetch last N intraday (REGULAR) candles
// ─────────────────────────────────────────────────────────────────────────────

async function fetchRecentCandles(symbol, limit = 10) {
  const { rows } = await queryWithTimeout(
    `SELECT open, high, low, close, volume, "timestamp"
     FROM intraday_1m
     WHERE symbol = $1
       AND session = 'REGULAR'
       AND "timestamp" >= NOW() - INTERVAL '1 day'
       AND close > 0
     ORDER BY "timestamp" DESC
     LIMIT $2`,
    [symbol, limit],
    { timeoutMs: 10_000, label: `refine.candles.${symbol}`, maxRetries: 0 }
  );
  // Return oldest-first so index 0 = oldest, last = most recent
  return rows.reverse().map(r => ({
    open:   Number(r.open),
    high:   Number(r.high),
    low:    Number(r.low),
    close:  Number(r.close),
    volume: Number(r.volume),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — Breakout confirmation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GAP_AND_GO breakout is confirmed when the last 3 REGULAR candles show:
 *   1. Most recent close > pmHigh
 *   2. Volume is increasing across all 3 candles
 *   3. No rejection wick > 50% of candle body on the most recent candle
 *
 * Returns { confirmed: boolean, note: string }
 */
function assessBreakoutConfirmation(candles, pmHigh, executionType) {
  // For FADE setups: confirm price broke below pm_low
  // For RANGE: same as GAP_AND_GO but below pm_low check

  if (!candles || candles.length < 3) {
    return { confirmed: false, note: 'insufficient_candles' };
  }

  const last3  = candles.slice(-3);
  const latest = last3[2];

  if (executionType === 'FADE') {
    // Fade confirmation: close below pmHigh (entry was pmLow, stop is pmHigh)
    // Price should be moving down — latest close below pmHigh
    const closesBelowEntry = last3.every(c => c.close < pmHigh);
    const volumeIncreasing = last3[1].volume > last3[0].volume && last3[2].volume > last3[1].volume;

    // Rejection wick check (for fade: check lower wick)
    const candleSize  = latest.high - latest.low;
    const lowerWick   = latest.close - latest.low;
    const rejectionWick = candleSize > 0 ? lowerWick / candleSize > 0.5 : false;

    if (!closesBelowEntry)  return { confirmed: false, note: 'price_not_below_pm_high' };
    if (rejectionWick)      return { confirmed: false, note: 'rejection_wick_on_fade' };
    if (!volumeIncreasing)  return { confirmed: false, note: 'volume_not_increasing' };
    return { confirmed: true, note: null };
  }

  // BREAKOUT / RANGE: confirm close above pmHigh
  const latestCloseAbovePmHigh = latest.close > pmHigh;
  if (!latestCloseAbovePmHigh) {
    return { confirmed: false, note: 'price_not_above_pm_high' };
  }

  // Volume increasing across last 3 candles
  const volumeIncreasing =
    last3[1].volume > last3[0].volume &&
    last3[2].volume > last3[1].volume;

  // Rejection wick: upper wick > 50% of candle range on most recent candle
  const candleSize  = latest.high - latest.low;
  const upperWick   = latest.high - latest.close;
  const rejectionWick = candleSize > 0 ? upperWick / candleSize > 0.5 : false;

  if (rejectionWick)     return { confirmed: false, note: 'rejection_wick_detected' };
  if (!volumeIncreasing) return { confirmed: false, note: 'volume_not_increasing' };
  return { confirmed: true, note: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — Breakout strength (0–5)
// ─────────────────────────────────────────────────────────────────────────────

function computeBreakoutStrength(candles) {
  if (!candles || candles.length < 2) return 0;

  const latest = candles[candles.length - 1];
  const prior  = candles.slice(0, -1);
  const avgVol = prior.reduce((s, c) => s + c.volume, 0) / prior.length;

  if (avgVol <= 0) return 0;

  const ratio = latest.volume / avgVol;
  return Math.min(5, Math.round(ratio * 100) / 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 — False breakout detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * If price broke above pmHigh in recent candles but has since closed back below
 * within 2 candles, it is a failed breakout.
 */
function detectFalseBreakout(candles, pmHigh, executionType) {
  if (!candles || candles.length < 3) return false;

  if (executionType === 'FADE') {
    // For FADE: false breakout is when price broke below pmLow (entry=pmLow)
    // but recovered above. We check a BREAKOUT from the other direction.
    // Spec only defines this for breakout direction — skip for FADE.
    return false;
  }

  // Check last 3 candles: was there a close above pmHigh followed by 2 closes below?
  const last3 = candles.slice(-3);
  const hadBreakout = last3.some(c => c.close > pmHigh);
  const currentlyBelow = last3[last3.length - 1].close <= pmHigh;

  // Also check the second-to-last
  const recentlyRejected =
    hadBreakout &&
    currentlyBelow &&
    last3.filter(c => c.close <= pmHigh).length >= 2;

  return recentlyRejected;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6 — Adaptive stop
// ─────────────────────────────────────────────────────────────────────────────

function adaptiveStop(pmLow, entryPrice, atr) {
  // Stop = MAX(pm_low, entry - ATR*0.75)
  const atrStop = entryPrice - (atr * 0.75);
  return Math.max(pmLow, atrStop);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 — Adaptive target
// ─────────────────────────────────────────────────────────────────────────────

function adaptiveTarget(entryPrice, atr, breakoutStrength, gapConfidence, executionType) {
  let multiplier;

  if (breakoutStrength > 3 && gapConfidence === 'HIGH') {
    multiplier = 2.0;
  } else if (breakoutStrength < 1.5) {
    multiplier = 1.0;
  } else {
    multiplier = 1.5;
  }

  // Direction: FADE targets go below entry; BREAKOUT/RANGE go above
  if (executionType === 'FADE') {
    return entryPrice - (atr * multiplier);
  }
  return entryPrice + (atr * multiplier);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9 — Execution rating
// ─────────────────────────────────────────────────────────────────────────────

function computeRating(entryConfirmed, breakoutStrength, rrRatio, sessionPhase) {
  // Raw rating before session adjustment
  let rating;

  if (entryConfirmed && breakoutStrength > 2 && rrRatio >= 2) {
    rating = 'ELITE';
  } else if (entryConfirmed && rrRatio >= 1.5) {
    rating = 'GOOD';
  } else if (!entryConfirmed || breakoutStrength < 1) {
    rating = 'WATCH';
  } else {
    rating = 'AVOID';
  }

  // Phase 8 — session-based downgrade
  if (sessionPhase === 'MIDDAY') {
    const order = ['ELITE', 'GOOD', 'WATCH', 'AVOID'];
    const idx   = order.indexOf(rating);
    rating = idx < order.length - 1 ? order[idx + 1] : 'AVOID';
  }

  return rating;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 10 — Execution notes
// ─────────────────────────────────────────────────────────────────────────────

function buildExecutionNotes(rating, sessionPhase, falseBreakout, confirmNote) {
  if (sessionPhase === 'PREMARKET') {
    return 'Premarket only — wait for open';
  }

  if (falseBreakout) {
    return 'Failed breakout — price broke level but closed back below within 2 candles';
  }

  if (confirmNote === 'rejection_wick_detected' || confirmNote === 'rejection_wick_on_fade') {
    return 'Rejection wick detected — sellers pushing back at breakout level';
  }

  if (confirmNote === 'volume_not_increasing') {
    return 'Volume declining — breakout lacks institutional conviction';
  }

  if (confirmNote === 'price_not_above_pm_high' || confirmNote === 'price_not_below_pm_high') {
    return 'Setup forming — awaiting price confirmation at key level';
  }

  switch (rating) {
    case 'ELITE':
      return 'Strong breakout with volume confirmation — momentum continuation likely';
    case 'GOOD':
      return 'Breakout confirmed — moderate continuation potential';
    case 'WATCH':
      return 'Setup forming — awaiting confirmation';
    default:
      return 'Conditions not favourable — high risk of failure';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Process one symbol
// ─────────────────────────────────────────────────────────────────────────────

async function refineSymbol(pw, sessionPhase) {
  const {
    symbol,
    execution_type,
    entry_price,
    pm_high,
    pm_low,
    atr,
    gap_confidence,
    risk_reward_ratio,
  } = pw;

  if (!execution_type || execution_type === 'NONE') {
    return {
      symbol,
      session_phase:    sessionPhase,
      entry_confirmed:  false,
      breakout_strength: 0,
      execution_rating: 'AVOID',
      execution_notes:  'No valid execution type',
      stop_price:       null,
      target_price:     null,
    };
  }

  const entryNum = Number(entry_price);
  const pmHighN  = Number(pm_high);
  const pmLowN   = Number(pm_low);
  const atrN     = Number(atr);

  // Session gate (Phase 8)
  if (sessionPhase === 'PREMARKET') {
    return {
      symbol,
      session_phase:    sessionPhase,
      entry_confirmed:  false,
      breakout_strength: null,
      execution_valid:  false,
      execution_rating: 'WATCH',
      execution_notes:  'Premarket only — wait for open',
      stop_price:       null,
      target_price:     null,
    };
  }

  // Fetch recent candles (10 for strength calc, confirmation uses last 3)
  let candles = [];
  try {
    candles = await fetchRecentCandles(symbol, 10);
  } catch (err) {
    console.warn(`${ENGINE_LABEL} ${symbol} candle fetch failed: ${err.message}`);
  }

  // Phase 5 — False breakout
  const falseBreakout = detectFalseBreakout(candles, pmHighN, execution_type);

  // Phase 3 — Breakout confirmation
  const { confirmed, note: confirmNote } = falseBreakout
    ? { confirmed: false, note: 'failed_breakout' }
    : assessBreakoutConfirmation(candles, pmHighN, execution_type);

  // Phase 4 — Breakout strength
  const strength = computeBreakoutStrength(candles);

  // Phase 6 — Adaptive stop (only applies if we have valid ATR and pm levels)
  let adaptedStop = null;
  if (Number.isFinite(atrN) && atrN > 0 && Number.isFinite(pmLowN) && Number.isFinite(entryNum)) {
    adaptedStop = execution_type === 'FADE'
      ? null   // For FADE the stop is pm_high — ATR doesn't tighten it meaningfully
      : Math.round(adaptiveStop(pmLowN, entryNum, atrN) * 10000) / 10000;
  }

  // Phase 7 — Adaptive target
  let adaptedTarget = null;
  if (Number.isFinite(atrN) && atrN > 0 && Number.isFinite(entryNum)) {
    adaptedTarget = Math.round(
      adaptiveTarget(entryNum, atrN, strength, gap_confidence, execution_type) * 10000
    ) / 10000;
  }

  // Phase 9 — Rating
  const rrNum = Number(risk_reward_ratio) || 0;
  const rating = computeRating(confirmed, strength, rrNum, sessionPhase);

  // Phase 10 — Notes
  const notes = buildExecutionNotes(rating, sessionPhase, falseBreakout, confirmNote);

  return {
    symbol,
    session_phase:     sessionPhase,
    entry_confirmed:   falseBreakout ? false : confirmed,
    breakout_strength: strength,
    execution_rating:  rating,
    execution_notes:   notes,
    stop_price:        adaptedStop,
    target_price:      adaptedTarget,
    execution_valid:   sessionPhase !== 'PREMARKET' && !falseBreakout,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch watchlist rows that have execution plans
// ─────────────────────────────────────────────────────────────────────────────

async function fetchExecutionRows() {
  const { rows } = await queryWithTimeout(
    `SELECT
       pw.symbol,
       pw.execution_type,
       pw.entry_price,
       pw.stop_price,
       pw.risk_reward_ratio,
       pw.premarket_gap_confidence  AS gap_confidence,
       -- Pull PM high/low from intraday (computed inline — not persisted separately)
       (SELECT MAX(high) FROM intraday_1m
        WHERE symbol = pw.symbol AND session = 'PREMARKET'
          AND "timestamp" >= NOW() - INTERVAL '2 days' AND close > 0) AS pm_high,
       (SELECT MIN(low)  FROM intraday_1m
        WHERE symbol = pw.symbol AND session = 'PREMARKET'
          AND "timestamp" >= NOW() - INTERVAL '2 days' AND close > 0) AS pm_low,
       COALESCE(mm.atr, 0)          AS atr
     FROM premarket_watchlist pw
     LEFT JOIN market_metrics mm ON mm.symbol = pw.symbol
     WHERE pw.execution_type IS NOT NULL
       AND pw.execution_type != 'NONE'`,
    [],
    { timeoutMs: 20_000, label: 'refine.execution_rows' }
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Write refinement back to premarket_watchlist
// ─────────────────────────────────────────────────────────────────────────────

async function writeRefinement(r) {
  const params = [
    r.symbol,
    r.entry_confirmed,
    r.breakout_strength,
    r.session_phase,
    r.execution_rating,
    r.execution_notes,
  ];

  // Only update stop/target when we computed adapted values
  if (r.stop_price !== null && r.target_price !== null) {
    await queryWithTimeout(
      `UPDATE premarket_watchlist SET
         entry_confirmed   = $2,
         breakout_strength = $3,
         session_phase     = $4,
         execution_rating  = $5,
         execution_notes   = $6,
         stop_price        = $7,
         target_price      = $8,
         execution_valid   = CASE WHEN $9 = FALSE THEN FALSE ELSE execution_valid END,
         updated_at        = NOW()
       WHERE symbol = $1`,
      [...params, r.stop_price, r.target_price, r.execution_valid ?? true],
      { timeoutMs: 10_000, label: `refine.write.${r.symbol}`, maxRetries: 0, poolType: 'write' }
    );
  } else {
    await queryWithTimeout(
      `UPDATE premarket_watchlist SET
         entry_confirmed   = $2,
         breakout_strength = $3,
         session_phase     = $4,
         execution_rating  = $5,
         execution_notes   = $6,
         execution_valid   = CASE WHEN $7 = FALSE THEN FALSE ELSE execution_valid END,
         updated_at        = NOW()
       WHERE symbol = $1`,
      [...params, r.execution_valid ?? true],
      { timeoutMs: 10_000, label: `refine.write.${r.symbol}`, maxRetries: 0, poolType: 'write' }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 11 — Signal log upgrade
// ─────────────────────────────────────────────────────────────────────────────

async function upgradeSignalLog(r) {
  // Only log ELITE + GOOD
  if (r.execution_rating !== 'ELITE' && r.execution_rating !== 'GOOD') return;

  await queryWithTimeout(
    `UPDATE signal_log SET
       entry_confirmed   = $2,
       breakout_strength = $3,
       execution_rating  = $4
     WHERE symbol = $1
       AND timestamp = (
         SELECT MAX(timestamp) FROM signal_log WHERE symbol = $1
       )`,
    [r.symbol, r.entry_confirmed, r.breakout_strength, r.execution_rating],
    {
      timeoutMs:  10_000,
      label:      `refine.signal_log.${r.symbol}`,
      maxRetries: 0,
      poolType:   'write',
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main run
// ─────────────────────────────────────────────────────────────────────────────

async function runExecutionRefinementEngine() {
  const t0 = Date.now();
  console.log(`${ENGINE_LABEL} starting`);

  const sessionPhase = getSessionPhase();
  console.log(`${ENGINE_LABEL} session_phase=${sessionPhase}`);

  let rows;
  try {
    rows = await fetchExecutionRows();
  } catch (err) {
    console.error(`${ENGINE_LABEL} failed to load execution rows:`, err.message);
    return { ok: false, error: err.message };
  }

  if (!rows || rows.length === 0) {
    console.warn(`${ENGINE_LABEL} no execution rows to refine`);
    return { ok: true, processed: 0, session_phase: sessionPhase };
  }

  console.log(`${ENGINE_LABEL} refining ${rows.length} symbols (phase=${sessionPhase})`);

  const results     = [];
  let refined       = 0;
  let confirmed     = 0;
  let falseBreakouts = 0;
  const ratingDist  = {};

  for (const row of rows) {
    try {
      const result = await refineSymbol(row, sessionPhase);
      results.push(result);

      await writeRefinement(result);
      await upgradeSignalLog(result);
      refined++;

      if (result.entry_confirmed)                  confirmed++;
      if (result.execution_notes?.startsWith('Failed breakout')) falseBreakouts++;

      const rt = result.execution_rating;
      ratingDist[rt] = (ratingDist[rt] || 0) + 1;

      console.log(
        `${ENGINE_LABEL} ${row.symbol}` +
        ` phase=${sessionPhase} confirmed=${result.entry_confirmed}` +
        ` strength=${result.breakout_strength?.toFixed(2) ?? 'n/a'}` +
        ` rating=${result.execution_rating}`
      );
    } catch (err) {
      console.error(`${ENGINE_LABEL} ${row.symbol} error: ${err.message}`);
    }

    if (INTER_SYMBOL_DELAY > 0) {
      await new Promise(r => setTimeout(r, INTER_SYMBOL_DELAY));
    }
  }

  const ms = Date.now() - t0;
  console.log(
    `${ENGINE_LABEL} done — refined=${refined} confirmed=${confirmed}` +
    ` false_breakouts=${falseBreakouts} ratings=${JSON.stringify(ratingDist)} ${ms}ms`
  );

  return {
    ok:                true,
    session_phase:     sessionPhase,
    processed:         rows.length,
    refined,
    confirmed_breakouts: confirmed,
    failed_breakouts:    falseBreakouts,
    rating_distribution: ratingDist,
    duration_ms:       ms,
    results,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler
// ─────────────────────────────────────────────────────────────────────────────

let _timer = null;

function startExecutionRefinementScheduler(intervalMs = 10 * 60 * 1000) {
  if (_timer) return;

  runExecutionRefinementEngine().catch(err =>
    console.error(`${ENGINE_LABEL} startup run failed:`, err.message)
  );

  _timer = setInterval(() => {
    runExecutionRefinementEngine().catch(err =>
      console.error(`${ENGINE_LABEL} scheduled run failed:`, err.message)
    );
  }, intervalMs);

  console.log(`${ENGINE_LABEL} scheduler started (interval=${intervalMs / 60000}min)`);
}

function stopExecutionRefinementScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log(`${ENGINE_LABEL} scheduler stopped`);
  }
}

module.exports = {
  runExecutionRefinementEngine,
  startExecutionRefinementScheduler,
  stopExecutionRefinementScheduler,
};
