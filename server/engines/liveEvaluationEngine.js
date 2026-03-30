'use strict';

/**
 * Live Evaluation Engine
 *
 * Runs every 5 minutes.
 * Guarantees EVERY signal in signal_log is evaluated — no gaps, no silent failures.
 *
 * Phase 2: Find unevaluated signals, fetch intraday candles, compute upside/drawdown
 * Phase 3: Classify outcome: WIN / LOSS / NEUTRAL (based on R multiples)
 * Phase 4: Write results — every signal marked evaluated, no exceptions
 * Phase 5: Retry failsafe — up to 3 retries, mark ERROR if all fail
 * Phase 6: Performance aggregation (every 30 min via separate timer)
 * Phase 7: Feedback loop — confidence_adjustment per setup performance
 */

const { queryWithTimeout } = require('../db/pg');

const ENGINE_LABEL       = '[LIVE_EVAL]';
const EVAL_LOOK_AHEAD_MS = 60 * 60 * 1000;   // 1 hour of candles after entry
const BATCH_SIZE         = 20;                 // process up to 20 per run
const MAX_RETRIES        = 3;
const INTER_SIGNAL_DELAY = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Fetch unevaluated signals
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPendingSignals() {
  const { rows } = await queryWithTimeout(
    `SELECT
       sl.id, sl.symbol, sl.timestamp, sl.entry_price,
       sl.stop_price, sl.target_price, sl.expected_move,
       sl.setup_type, sl.execution_rating, sl.stage
     FROM signal_log sl
     WHERE sl.evaluated = false
       AND sl.timestamp < NOW() - INTERVAL '5 minutes'
     ORDER BY sl.timestamp ASC
     LIMIT $1`,
    [BATCH_SIZE],
    { timeoutMs: 15_000, label: 'live_eval.pending' }
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Fetch intraday candles after entry
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPostEntryCandles(symbol, entryTimestamp) {
  const from = new Date(entryTimestamp);
  const to   = new Date(from.getTime() + EVAL_LOOK_AHEAD_MS);

  const { rows } = await queryWithTimeout(
    `SELECT high, low, close, "timestamp"
     FROM intraday_1m
     WHERE symbol = $1
       AND "timestamp" >= $2
       AND "timestamp" <= $3
       AND close > 0
     ORDER BY "timestamp" ASC`,
    [symbol, from.toISOString(), to.toISOString()],
    { timeoutMs: 15_000, label: `live_eval.candles.${symbol}`, maxRetries: 0 }
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Compute upside / drawdown from candles
// ─────────────────────────────────────────────────────────────────────────────

function computeMetrics(candles, entryPrice) {
  if (!candles || candles.length === 0 || !entryPrice || entryPrice <= 0) {
    return { max_upside_pct: null, max_drawdown_pct: null };
  }

  const entry = Number(entryPrice);
  let maxHigh = entry;
  let minLow  = entry;

  for (const c of candles) {
    const h = Number(c.high);
    const l = Number(c.low);
    if (Number.isFinite(h)) maxHigh = Math.max(maxHigh, h);
    if (Number.isFinite(l))  minLow  = Math.min(minLow,  l);
  }

  const maxUpsidePct   = ((maxHigh - entry) / entry) * 100;
  const maxDrawdownPct = ((minLow  - entry) / entry) * 100; // negative

  return {
    max_upside_pct:   Math.round(maxUpsidePct   * 1000) / 1000,
    max_drawdown_pct: Math.round(maxDrawdownPct * 1000) / 1000,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — Classify outcome
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R = expected_move_pct / 2
 * WIN:     max_upside  >= 2R
 * LOSS:    max_drawdown <= -1R
 * NEUTRAL: everything else
 */
function classifyOutcome(maxUpsidePct, maxDrawdownPct, expectedMovePct) {
  const move = Math.abs(Number(expectedMovePct) || 0);
  if (move <= 0) return 'NEUTRAL';

  const R = move / 2;
  if (maxUpsidePct != null   && maxUpsidePct   >=  2 * R) return 'WIN';
  if (maxDrawdownPct != null && maxDrawdownPct <= -1 * R) return 'LOSS';
  return 'NEUTRAL';
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — Write result (mandatory — every signal must be marked evaluated)
// ─────────────────────────────────────────────────────────────────────────────

async function writeResult(id, outcome, maxUpsidePct, maxDrawdownPct) {
  await queryWithTimeout(
    `UPDATE signal_log SET
       evaluated       = true,
       outcome         = $2,
       max_upside_pct  = $3,
       max_drawdown_pct = $4,
       evaluated_at    = NOW()
     WHERE id = $1`,
    [id, outcome, maxUpsidePct, maxDrawdownPct],
    {
      timeoutMs:  10_000,
      label:      `live_eval.write.${id}`,
      maxRetries: 0,
      poolType:   'write',
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 — Evaluate one signal with retry failsafe
// ─────────────────────────────────────────────────────────────────────────────

async function evaluateSignal(signal) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const candles = await fetchPostEntryCandles(signal.symbol, signal.timestamp);
      const { max_upside_pct, max_drawdown_pct } = computeMetrics(candles, signal.entry_price);
      const outcome = classifyOutcome(max_upside_pct, max_drawdown_pct, signal.expected_move);

      await writeResult(signal.id, outcome, max_upside_pct, max_drawdown_pct);

      return { id: signal.id, symbol: signal.symbol, outcome, max_upside_pct, max_drawdown_pct, candle_count: candles.length };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
  }

  // Phase 5 failsafe: mark ERROR so signal is never stuck unevaluated
  console.error(`${ENGINE_LABEL} [EVAL ERROR] signal ${signal.id} (${signal.symbol}) failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
  try {
    await writeResult(signal.id, 'ERROR', null, null);
  } catch (_) {
    // Last-resort direct upsert if even the write failed
    await queryWithTimeout(
      `UPDATE signal_log SET evaluated = true, outcome = 'ERROR', evaluated_at = NOW() WHERE id = $1`,
      [signal.id],
      { timeoutMs: 5000, label: `live_eval.failsafe.${signal.id}`, poolType: 'write' }
    );
  }

  return { id: signal.id, symbol: signal.symbol, outcome: 'ERROR', error: lastError?.message };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6 — Performance aggregation
// ─────────────────────────────────────────────────────────────────────────────

async function runPerformanceAggregation() {
  const t0 = Date.now();
  console.log(`${ENGINE_LABEL} [PERF] aggregating performance`);

  // Aggregate per period × setup_type × execution_rating
  const aggregateSql = `
    WITH base AS (
      SELECT
        sl.setup_type,
        sl.execution_rating,
        sl.stage                                          AS session_phase,
        -- signal_type: derive from execution_rating tier label where available
        COALESCE(sl.setup_type, sl.execution_rating, 'UNKNOWN') AS signal_type,
        sl.outcome,
        sl.max_upside_pct,
        sl.max_drawdown_pct,
        CASE
          WHEN sl.timestamp >= CURRENT_DATE            THEN 'today'
          WHEN sl.timestamp >= NOW() - INTERVAL '7 days' THEN '7d'
          ELSE 'all'
        END                                              AS period_label
      FROM signal_log sl
      WHERE sl.evaluated = true
        AND sl.outcome IS NOT NULL
        AND sl.outcome != 'ERROR'
    ),
    grouped AS (
      SELECT
        period_label,
        COALESCE(setup_type,       'ALL') AS setup_type,
        COALESCE(execution_rating, 'ALL') AS execution_rating,
        COALESCE(session_phase,    'ALL') AS session_phase,
        COALESCE(signal_type,      'ALL') AS signal_type,
        COUNT(*)                          AS total_signals,
        COUNT(*) FILTER (WHERE outcome = 'WIN')     AS win_count,
        COUNT(*) FILTER (WHERE outcome = 'LOSS')    AS loss_count,
        COUNT(*) FILTER (WHERE outcome = 'NEUTRAL') AS neutral_count,
        COUNT(*) FILTER (WHERE outcome = 'ERROR')   AS error_count,
        ROUND(AVG(max_upside_pct)::numeric,   3)    AS avg_return,
        ROUND(AVG(max_drawdown_pct)::numeric, 3)    AS avg_drawdown
      FROM base
      GROUP BY period_label, setup_type, execution_rating, session_phase, signal_type
    )
    SELECT
      *,
      CASE WHEN total_signals > 0
           THEN ROUND((win_count::numeric / total_signals) * 100, 1)
           ELSE 0 END AS win_rate,
      -- Phase 7 confidence adjustment
      CASE
        WHEN total_signals < 5 THEN 0  -- insufficient sample
        WHEN (win_count::numeric / total_signals) > 0.7  THEN  10
        WHEN (win_count::numeric / total_signals) > 0.5  THEN   5
        WHEN (win_count::numeric / total_signals) > 0.3  THEN  -5
        ELSE                                                   -10
      END AS confidence_adjustment
    FROM grouped
    ORDER BY period_label, total_signals DESC
  `;

  const { rows } = await queryWithTimeout(aggregateSql, [], {
    timeoutMs: 30_000,
    label:     'live_eval.perf_aggregate',
  });

  if (!rows || rows.length === 0) {
    console.log(`${ENGINE_LABEL} [PERF] no evaluated data to aggregate`);
    return { ok: true, rows_written: 0 };
  }

  // Upsert into signal_performance_summary
  let written = 0;
  for (const r of rows) {
    try {
      await queryWithTimeout(
        `INSERT INTO signal_performance_summary
           (period_label, setup_type, execution_rating, session_phase, signal_type,
            total_signals, win_count, loss_count, neutral_count, error_count,
            win_rate, avg_return, avg_drawdown, confidence_adjustment, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
         ON CONFLICT (period_label, setup_type, execution_rating, session_phase, signal_type)
         DO UPDATE SET
           total_signals         = EXCLUDED.total_signals,
           win_count             = EXCLUDED.win_count,
           loss_count            = EXCLUDED.loss_count,
           neutral_count         = EXCLUDED.neutral_count,
           error_count           = EXCLUDED.error_count,
           win_rate              = EXCLUDED.win_rate,
           avg_return            = EXCLUDED.avg_return,
           avg_drawdown          = EXCLUDED.avg_drawdown,
           confidence_adjustment = EXCLUDED.confidence_adjustment,
           updated_at            = NOW()`,
        [
          r.period_label, r.setup_type, r.execution_rating, r.session_phase, r.signal_type,
          r.total_signals, r.win_count, r.loss_count, r.neutral_count, r.error_count,
          r.win_rate, r.avg_return, r.avg_drawdown, r.confidence_adjustment,
        ],
        { timeoutMs: 10_000, label: 'live_eval.perf_upsert', maxRetries: 0, poolType: 'write' }
      );
      written++;
    } catch (err) {
      console.warn(`${ENGINE_LABEL} [PERF] upsert failed for row:`, err.message);
    }
  }

  const ms = Date.now() - t0;
  console.log(`${ENGINE_LABEL} [PERF] written=${written} rows in ${ms}ms`);
  return { ok: true, rows_written: written, duration_ms: ms };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main evaluation run
// ─────────────────────────────────────────────────────────────────────────────

async function runLiveEvaluationEngine() {
  const t0 = Date.now();
  console.log(`${ENGINE_LABEL} starting`);

  let pending;
  try {
    pending = await fetchPendingSignals();
  } catch (err) {
    console.error(`${ENGINE_LABEL} failed to fetch pending signals:`, err.message);
    return { ok: false, error: err.message };
  }

  if (!pending || pending.length === 0) {
    console.log(`${ENGINE_LABEL} no pending signals`);
    return { ok: true, evaluated: 0 };
  }

  console.log(`${ENGINE_LABEL} evaluating ${pending.length} signals`);

  const results  = [];
  let wins       = 0;
  let losses     = 0;
  let neutrals   = 0;
  let errors     = 0;

  for (const signal of pending) {
    const result = await evaluateSignal(signal);
    results.push(result);

    switch (result.outcome) {
      case 'WIN':     wins++;     break;
      case 'LOSS':    losses++;   break;
      case 'ERROR':   errors++;   break;
      default:        neutrals++; break;
    }

    console.log(
      `${ENGINE_LABEL} id=${result.id} ${result.symbol}` +
      ` outcome=${result.outcome} up=${result.max_upside_pct?.toFixed(2) ?? 'n/a'}%` +
      ` dn=${result.max_drawdown_pct?.toFixed(2) ?? 'n/a'}%`
    );

    if (INTER_SIGNAL_DELAY > 0) {
      await new Promise(r => setTimeout(r, INTER_SIGNAL_DELAY));
    }
  }

  const ms = Date.now() - t0;
  console.log(
    `${ENGINE_LABEL} done — evaluated=${pending.length}` +
    ` wins=${wins} losses=${losses} neutral=${neutrals} errors=${errors} ${ms}ms`
  );

  return {
    ok:        true,
    evaluated: pending.length,
    wins,
    losses,
    neutrals,
    errors,
    duration_ms: ms,
    results,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedulers
// ─────────────────────────────────────────────────────────────────────────────

let _evalTimer = null;
let _perfTimer = null;

function startLiveEvaluationScheduler(intervalMs = 5 * 60 * 1000) {
  if (_evalTimer) return;

  runLiveEvaluationEngine().catch(err =>
    console.error(`${ENGINE_LABEL} startup eval failed:`, err.message)
  );

  _evalTimer = setInterval(() => {
    runLiveEvaluationEngine().catch(err =>
      console.error(`${ENGINE_LABEL} scheduled eval failed:`, err.message)
    );
  }, intervalMs);

  // Performance aggregation runs every 30 minutes (staggered 2 min after eval start)
  setTimeout(() => {
    runPerformanceAggregation().catch(err =>
      console.error(`${ENGINE_LABEL} startup perf agg failed:`, err.message)
    );

    _perfTimer = setInterval(() => {
      runPerformanceAggregation().catch(err =>
        console.error(`${ENGINE_LABEL} scheduled perf agg failed:`, err.message)
      );
    }, 30 * 60 * 1000);
  }, 2 * 60 * 1000);

  console.log(`${ENGINE_LABEL} eval scheduler started (interval=${intervalMs / 60000}min)`);
}

function stopLiveEvaluationScheduler() {
  if (_evalTimer) { clearInterval(_evalTimer); _evalTimer = null; }
  if (_perfTimer) { clearInterval(_perfTimer); _perfTimer = null; }
  console.log(`${ENGINE_LABEL} schedulers stopped`);
}

module.exports = {
  runLiveEvaluationEngine,
  runPerformanceAggregation,
  startLiveEvaluationScheduler,
  stopLiveEvaluationScheduler,
};
