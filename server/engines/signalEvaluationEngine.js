'use strict';

/**
 * Signal Evaluation Engine — Phases 5 + 6
 *
 * Runs every 15 minutes.
 *
 * Phase 5 — Outcome evaluation:
 *   For each unevaluated signal_log row older than 30 minutes:
 *   1. Fetch intraday_1m candles from entry timestamp onwards
 *   2. Compute max_upside_pct and max_drawdown_pct from entry price
 *   3. Classify outcome:
 *        WIN:     max_upside_pct >= expected_move
 *        LOSS:    max_drawdown_pct <= -(expected_move / 2)
 *        NEUTRAL: neither
 *   4. UPDATE signal_log with results
 *
 * Phase 6 — Daily performance aggregation:
 *   Run hourly (every 4th 15-min tick).
 *   Aggregate signal_log by calendar day → INSERT/UPDATE signal_performance_daily.
 */

const { queryWithTimeout } = require('../db/pg');

const ENGINE_LABEL = '[SIGNAL_EVAL]';
const EVAL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let _timer        = null;
let _tickCount    = 0;

/* ── Phase 5 — evaluate pending signals ─────────────────────────────────── */

async function evaluateSignals() {
  const t0 = Date.now();
  console.log(`${ENGINE_LABEL} evaluation pass starting`);

  let pending;
  try {
    const result = await queryWithTimeout(
      `SELECT id, symbol, timestamp, entry_price, expected_move
       FROM   signal_log
       WHERE  evaluated = FALSE
         AND  timestamp < NOW() - INTERVAL '30 minutes'
       ORDER BY timestamp ASC
       LIMIT 100`,
      [],
      { label: 'signal_eval.fetch_pending', timeoutMs: 10_000 }
    );
    pending = result.rows;
  } catch (err) {
    console.error(`${ENGINE_LABEL} fetch pending failed:`, err.message);
    return { ok: false, error: err.message };
  }

  if (!pending || pending.length === 0) {
    console.log(`${ENGINE_LABEL} no pending signals to evaluate`);
    return { ok: true, evaluated: 0 };
  }

  let evaluated = 0;

  for (const sig of pending) {
    const entryPrice   = Number(sig.entry_price);
    const expectedMove = Number(sig.expected_move) || 1;

    // Skip signals without a valid entry price
    if (!entryPrice || entryPrice <= 0) {
      await _markEvaluated(sig.id, 'NEUTRAL', null, null);
      continue;
    }

    try {
      // Fetch intraday candles since the signal was logged
      const candlesResult = await queryWithTimeout(
        `SELECT high, low
         FROM   intraday_1m
         WHERE  symbol = $1
           AND  "timestamp" >= $2
         ORDER BY "timestamp" ASC
         LIMIT 500`,
        [sig.symbol, sig.timestamp],
        { label: `signal_eval.candles.${sig.symbol}`, timeoutMs: 10_000 }
      );

      const candles = candlesResult.rows;

      if (!candles || candles.length === 0) {
        await _markEvaluated(sig.id, 'NEUTRAL', null, null);
        evaluated++;
        continue;
      }

      // Compute max upside and max drawdown from entry price
      let maxHigh = entryPrice;
      let minLow  = entryPrice;

      for (const c of candles) {
        const h = Number(c.high);
        const l = Number(c.low);
        if (h > maxHigh) maxHigh = h;
        if (l < minLow)  minLow  = l;
      }

      const maxUpsidePct   = ((maxHigh - entryPrice) / entryPrice) * 100;
      const maxDrawdownPct = ((minLow  - entryPrice) / entryPrice) * 100;

      let outcome;
      if (maxUpsidePct >= expectedMove) {
        outcome = 'WIN';
      } else if (maxDrawdownPct <= -(expectedMove / 2)) {
        outcome = 'LOSS';
      } else {
        outcome = 'NEUTRAL';
      }

      await queryWithTimeout(
        `UPDATE signal_log
         SET  evaluated        = TRUE,
              max_upside_pct   = $2,
              max_drawdown_pct = $3,
              outcome          = $4
         WHERE id = $1`,
        [sig.id, maxUpsidePct, maxDrawdownPct, outcome],
        { label: `signal_eval.update.${sig.symbol}`, timeoutMs: 5000, poolType: 'write' }
      );

      evaluated++;

    } catch (err) {
      console.warn(`${ENGINE_LABEL} eval failed for ${sig.symbol} (id=${sig.id}):`, err.message);
    }
  }

  const ms = Date.now() - t0;
  console.log(`${ENGINE_LABEL} evaluation done — evaluated=${evaluated}, pending=${pending.length}, ${ms}ms`);

  return { ok: true, evaluated, duration_ms: ms };
}

async function _markEvaluated(id, outcome, maxUpside, maxDrawdown) {
  try {
    await queryWithTimeout(
      `UPDATE signal_log
       SET  evaluated        = TRUE,
            outcome          = $2,
            max_upside_pct   = $3,
            max_drawdown_pct = $4
       WHERE id = $1`,
      [id, outcome, maxUpside, maxDrawdown],
      { label: `signal_eval.mark.${id}`, timeoutMs: 5000, poolType: 'write' }
    );
  } catch (_) {}
}

/* ── Phase 6 — daily performance aggregation ─────────────────────────────── */

async function aggregatePerformance() {
  console.log(`${ENGINE_LABEL} aggregation pass starting`);

  // Aggregate the previous calendar day (fully evaluated) and today (partial)
  try {
    const result = await queryWithTimeout(
      `INSERT INTO signal_performance_daily
         (date, total_signals, wins, losses, win_rate, avg_return)
       SELECT
         DATE(timestamp)                                                AS date,
         COUNT(*)                                                       AS total_signals,
         SUM(CASE WHEN outcome = 'WIN'  THEN 1 ELSE 0 END)            AS wins,
         SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END)            AS losses,
         CASE
           WHEN COUNT(*) > 0
           THEN ROUND(
             SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END)::numeric
             / COUNT(*) * 100,
             1
           )
           ELSE 0
         END                                                            AS win_rate,
         ROUND(AVG(COALESCE(max_upside_pct, 0)), 2)                   AS avg_return
       FROM signal_log
       WHERE evaluated = TRUE
         AND DATE(timestamp) >= CURRENT_DATE - INTERVAL '2 days'
       GROUP BY DATE(timestamp)
       ON CONFLICT (date) DO UPDATE SET
         total_signals = EXCLUDED.total_signals,
         wins          = EXCLUDED.wins,
         losses        = EXCLUDED.losses,
         win_rate      = EXCLUDED.win_rate,
         avg_return    = EXCLUDED.avg_return`,
      [],
      { label: 'signal_eval.aggregate', timeoutMs: 15_000, poolType: 'write' }
    );

    console.log(`${ENGINE_LABEL} aggregation done — rows affected=${result.rowCount}`);
    return result.rowCount;
  } catch (err) {
    console.error(`${ENGINE_LABEL} aggregation failed:`, err.message);
    return 0;
  }
}

/* ── Status query (for report generation) ───────────────────────────────── */

async function getSignalStats() {
  try {
    const result = await queryWithTimeout(
      `SELECT
         COUNT(*)                                                       AS total,
         SUM(CASE WHEN evaluated = TRUE THEN 1 ELSE 0 END)            AS evaluated,
         SUM(CASE WHEN outcome = 'WIN'  THEN 1 ELSE 0 END)            AS wins,
         SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END)            AS losses
       FROM signal_log`,
      [],
      { label: 'signal_eval.stats', timeoutMs: 10_000 }
    );
    const row = result.rows[0] || {};
    const total     = Number(row.total     ?? 0);
    const evaluated = Number(row.evaluated ?? 0);
    const wins      = Number(row.wins      ?? 0);
    const losses    = Number(row.losses    ?? 0);
    const win_rate  = evaluated > 0 ? Math.round((wins / evaluated) * 1000) / 10 : null;
    return { total, evaluated, wins, losses, win_rate };
  } catch (err) {
    console.error(`${ENGINE_LABEL} stats query failed:`, err.message);
    return { total: 0, evaluated: 0, wins: 0, losses: 0, win_rate: null };
  }
}

/* ── Scheduler ───────────────────────────────────────────────────────────── */

function startSignalEvaluationScheduler(intervalMs = EVAL_INTERVAL_MS) {
  if (_timer) return;

  // Initial run
  evaluateSignals().catch((err) =>
    console.error(`${ENGINE_LABEL} startup eval failed:`, err.message)
  );

  _timer = setInterval(async () => {
    _tickCount++;
    await evaluateSignals().catch((err) =>
      console.error(`${ENGINE_LABEL} tick eval failed:`, err.message)
    );
    // Aggregate performance every 4th tick (~60 min)
    if (_tickCount % 4 === 0) {
      await aggregatePerformance().catch((err) =>
        console.error(`${ENGINE_LABEL} tick aggregate failed:`, err.message)
      );
    }
  }, intervalMs);

  console.log(`${ENGINE_LABEL} scheduler started (interval=${intervalMs / 60000}min, aggregate every 60min)`);
}

function stopSignalEvaluationScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log(`${ENGINE_LABEL} scheduler stopped`);
  }
}

module.exports = {
  evaluateSignals,
  aggregatePerformance,
  getSignalStats,
  startSignalEvaluationScheduler,
  stopSignalEvaluationScheduler,
};
