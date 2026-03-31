'use strict';

/**
 * Learning Engine
 *
 * Computes per-strategy performance metrics from signal_outcomes and writes
 * adaptive weights + status to strategy_learning_metrics.
 *
 * Weight formula:  clamp(1.0 + (win_rate - 0.5) * 2.0,  0.5, 2.0)
 *   win_rate 0.00 → weight 0.50 (clamped)
 *   win_rate 0.50 → weight 1.00 (neutral — no data or exactly 50%)
 *   win_rate 0.75 → weight 1.50
 *   win_rate 1.00 → weight 2.00
 *
 * Disable threshold:  win_rate < 0.25 with >= MIN_SAMPLE_SIZE decided outcomes
 * Re-enable threshold: win_rate >= 0.35 after new evidence accumulates
 *
 * All in-memory caches (_disabledStrategies, _strategyWeights) are refreshed
 * every time runLearningEngine() fires (default: every 15 min).  Reading them
 * is O(1) and safe to call on every signal loop iteration.
 */

const { queryWithTimeout } = require('../db/pg');

const MIN_SAMPLE_SIZE    = 20;   // decided (WIN+LOSS) outcomes needed to adjust weight
const DISABLE_THRESHOLD  = 0.25; // auto-disable below this win rate
const REENABLE_THRESHOLD = 0.35; // re-enable above this win rate

// ── In-memory caches (refreshed by runLearningEngine) ─────────────────────────
let _disabledStrategies = new Set();
let _strategyWeights    = new Map();   // strategy → weight (float)
let _lastRun            = null;

// ── Public fast accessors ──────────────────────────────────────────────────────

/**
 * Returns the Set of currently disabled strategy names.
 * O(1) — safe to call inside tight signal loops.
 */
function getDisabledStrategies() {
  return _disabledStrategies;
}

/**
 * Returns the adaptive weight multiplier for a strategy.
 * Returns 1.0 (neutral) when no learning data exists yet.
 */
function getStrategyWeight(strategy) {
  return _strategyWeights.get(strategy) ?? 1.0;
}

// ── Performance aggregation ────────────────────────────────────────────────────

/**
 * Reads signal_outcomes grouped by setup_type for the past N days.
 * Returns Map<strategy, { wins, losses, neutrals, evaluated, decided, win_rate }>
 */
async function getStrategyPerformance(lookbackDays = 30) {
  const res = await queryWithTimeout(
    `SELECT
       setup_type,
       COUNT(*) FILTER (WHERE outcome = 'WIN')::int     AS wins,
       COUNT(*) FILTER (WHERE outcome = 'LOSS')::int    AS losses,
       COUNT(*) FILTER (WHERE outcome = 'NEUTRAL')::int AS neutrals,
       COUNT(*) FILTER (WHERE outcome IS NOT NULL)::int AS evaluated
     FROM signal_outcomes
     WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
       AND setup_type IS NOT NULL
     GROUP BY setup_type`,
    [String(lookbackDays)],
    { timeoutMs: 10000, label: 'learning.strategy_performance', maxRetries: 0 }
  );

  const map = new Map();
  for (const row of res.rows || []) {
    const wins    = Number(row.wins    || 0);
    const losses  = Number(row.losses  || 0);
    const decided = wins + losses; // NEUTRAL excluded from win_rate denominator
    map.set(row.setup_type, {
      wins,
      losses,
      neutrals:  Number(row.neutrals  || 0),
      evaluated: Number(row.evaluated || 0),
      decided,
      win_rate: decided > 0 ? wins / decided : null,
    });
  }
  return map;
}

// ── Weight computation ─────────────────────────────────────────────────────────

/**
 * Maps strategy stats to an adaptive weight.
 * Returns 1.0 (neutral) when sample is below MIN_SAMPLE_SIZE.
 */
function computeStrategyWeight(stats) {
  if (!stats || stats.decided < MIN_SAMPLE_SIZE || stats.win_rate === null) return 1.0;
  return Math.max(0.5, Math.min(2.0, 1.0 + (stats.win_rate - 0.5) * 2.0));
}

// ── Core learning loop ─────────────────────────────────────────────────────────

/**
 * Reads outcome data, upserts strategy_learning_metrics, and refreshes
 * in-memory caches for disabled strategies and weights.
 */
async function updateLearningMetrics() {
  const perfMap = await getStrategyPerformance(30);

  if (perfMap.size === 0) {
    console.log('[LEARNING] No strategy outcomes available — caches unchanged');
    return { updated: 0, disabled: 0, reenabled: 0 };
  }

  // Work on copies so we only swap atomically at the end
  const newDisabled = new Set(_disabledStrategies);
  const newWeights  = new Map(_strategyWeights);

  let updated  = 0;
  let disabled = 0;
  let reenabled = 0;

  for (const [strategy, stats] of perfMap) {
    const weight             = computeStrategyWeight(stats);
    const hasSufficientData  = stats.decided >= MIN_SAMPLE_SIZE;

    // ── Auto-disable / re-enable ───────────────────────────────────────────
    let status = newDisabled.has(strategy) ? 'disabled' : 'active';

    if (hasSufficientData && stats.win_rate !== null) {
      if (stats.win_rate < DISABLE_THRESHOLD && !newDisabled.has(strategy)) {
        newDisabled.add(strategy);
        status = 'disabled';
        disabled++;
        console.log(
          `[LEARNING] AUTO-DISABLED strategy="${strategy}" ` +
          `win_rate=${(stats.win_rate * 100).toFixed(1)}% decided=${stats.decided}`
        );
      } else if (stats.win_rate >= REENABLE_THRESHOLD && newDisabled.has(strategy)) {
        newDisabled.delete(strategy);
        status = 'active';
        reenabled++;
        console.log(
          `[LEARNING] RE-ENABLED strategy="${strategy}" ` +
          `win_rate=${(stats.win_rate * 100).toFixed(1)}% decided=${stats.decided}`
        );
      }
    }

    newWeights.set(strategy, weight);

    const winRateVal       = stats.win_rate !== null ? Number(stats.win_rate.toFixed(4)) : null;
    const falseSignalRate  = winRateVal !== null ? Number((1 - winRateVal).toFixed(4)) : null;
    const edgeScore        = winRateVal !== null ? Number(((winRateVal - 0.5) * 100).toFixed(2)) : null;
    const learningScore    = winRateVal !== null ? Number((winRateVal * weight * 100).toFixed(2)) : null;

    await queryWithTimeout(
      `INSERT INTO strategy_learning_metrics
         (strategy, signals_count, win_rate, avg_return, median_return, max_return,
          false_signal_rate, edge_score, learning_score,
          weight, status, sample_size, last_evaluated_at, updated_at)
       VALUES ($1,$2,$3,NULL,NULL,NULL,$4,$5,$6,$7,$8,$9,NOW(),NOW())
       ON CONFLICT (strategy) DO UPDATE SET
         signals_count     = EXCLUDED.signals_count,
         win_rate          = EXCLUDED.win_rate,
         false_signal_rate = EXCLUDED.false_signal_rate,
         edge_score        = EXCLUDED.edge_score,
         learning_score    = EXCLUDED.learning_score,
         weight            = EXCLUDED.weight,
         status            = EXCLUDED.status,
         sample_size       = EXCLUDED.sample_size,
         last_evaluated_at = EXCLUDED.last_evaluated_at,
         updated_at        = NOW()`,
      [
        strategy,
        stats.evaluated,
        winRateVal,
        falseSignalRate,
        edgeScore,
        learningScore,
        Number(weight.toFixed(4)),
        status,
        stats.decided,
      ],
      { timeoutMs: 5000, label: 'learning.upsert_metrics', maxRetries: 0 }
    );

    updated++;
  }

  // Atomic cache swap
  _disabledStrategies = newDisabled;
  _strategyWeights    = newWeights;
  _lastRun            = new Date().toISOString();

  return { updated, disabled, reenabled };
}

// ── Health endpoint data ───────────────────────────────────────────────────────

/**
 * Returns a summary of learning engine state for /api/system/health.
 */
async function getLearningMetrics() {
  try {
    const res = await queryWithTimeout(
      `SELECT strategy, win_rate, weight, status, sample_size, updated_at
       FROM strategy_learning_metrics
       ORDER BY COALESCE(win_rate, 0) DESC`,
      [],
      { timeoutMs: 5000, label: 'learning.health_metrics', maxRetries: 0 }
    );

    const rows     = res.rows || [];
    const active   = rows.filter(r => r.status === 'active');
    const disabled = rows.filter(r => r.status === 'disabled');
    const best     = active[0]                  ?? null;
    const worst    = active[active.length - 1]  ?? null;

    const avgWinRate = active.length > 0
      ? Number(
          (active.reduce((s, r) => s + Number(r.win_rate || 0), 0) / active.length)
          .toFixed(3)
        )
      : null;

    return {
      strategies_tracked:  rows.length,
      active_strategies:   active.length,
      disabled_strategies: disabled.map(r => r.strategy),
      best_strategy:  best  ? { name: best.strategy,  win_rate: Number(best.win_rate  || 0), weight: Number(best.weight  || 1) } : null,
      worst_strategy: worst ? { name: worst.strategy, win_rate: Number(worst.win_rate || 0), weight: Number(worst.weight || 1) } : null,
      avg_win_rate: avgWinRate,
      last_run: _lastRun,
    };
  } catch (err) {
    console.warn('[LEARNING] getLearningMetrics failed:', err.message);
    return null;
  }
}

// ── Main entry point ───────────────────────────────────────────────────────────

async function runLearningEngine() {
  try {
    console.log('[LEARNING] Starting learning engine cycle...');
    const result = await updateLearningMetrics();
    console.log(
      `[LEARNING] Cycle complete — updated=${result.updated} ` +
      `disabled=${result.disabled} reenabled=${result.reenabled}`
    );
    return result;
  } catch (err) {
    console.error('[LEARNING] runLearningEngine failed:', err.message);
    return { error: err.message };
  }
}

module.exports = {
  runLearningEngine,
  getDisabledStrategies,
  getStrategyWeight,
  getLearningMetrics,
  // Exported for testing
  computeStrategyWeight,
  getStrategyPerformance,
};
