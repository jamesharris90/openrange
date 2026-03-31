'use strict';

/**
 * Learning Engine — Context-Aware Edition
 *
 * Computes per-strategy performance metrics using four context layers:
 *
 *   Phase 1 — Recency weighting
 *     Trades from the last 24h count 1.0×, 1–3 days 0.7×, 3–7 days 0.4×.
 *     Recent behaviour dominates; stale data fades out naturally.
 *
 *   Phase 2 — Regime-aware learning
 *     Win rates are computed separately per (strategy, regime) and stored
 *     in strategy_regime_metrics.  This reveals that e.g. "Gap & Go" may
 *     win 65% in BULL markets but only 28% in BEAR markets.
 *
 *   Phase 3 — Regime filtering (enforced in signal engines)
 *     getRegimeWinRate(strategy, regime) is exported for signal engines
 *     to skip strategies that perform poorly in the current regime.
 *
 *   Phase 4 — Validation quality weight
 *     Outcomes flagged as had_validation_issues (or whose symbol appears
 *     in data_validation_log near signal time) get a 0.7× weight.
 *     Bad data has less influence on learned win rates.
 *
 *   Phase 5 — Confidence accuracy / feedback loop
 *     For signals where predicted_confidence was stored, track whether
 *     high-confidence (>70) predictions actually won.  confidence_accuracy
 *     = actual_high_conf_win_rate / expected_win_rate.
 *     Values < 1.0 mean the system is overconfident; exported to
 *     confidenceEngine for calibration.
 *
 * In-memory caches (refreshed every 15 min):
 *   _disabledStrategies  Set<string>
 *   _strategyWeights     Map<strategy, weight>
 *   _regimeMetrics       Map<"strategy::regime", weighted_win_rate>
 *   _confidenceAccuracy  Map<strategy, accuracy_ratio>
 */

const { queryWithTimeout } = require('../db/pg');

// ── Constants ──────────────────────────────────────────────────────────────────
const MIN_SAMPLE_SIZE        = 20;   // decided outcomes needed to adjust weight
const DISABLE_THRESHOLD      = 0.25; // auto-disable below this weighted win rate
const REENABLE_THRESHOLD     = 0.35; // re-enable above this
const REGIME_FILTER_THRESHOLD = 0.30; // regime-specific win rate below this → skip in that regime
const MIN_REGIME_SAMPLE      = 10;   // min decided outcomes per regime for regime filtering
const MIN_CONF_FEEDBACK      = 5;    // min high-conf outcomes needed to compute accuracy
const LOOKBACK_DAYS          = 7;    // learning window (recency weights handle decay within)

// Recency weights (Phase 1)
const WEIGHT_0_1D  = 1.0;
const WEIGHT_1_3D  = 0.7;
const WEIGHT_3_7D  = 0.4;

// Validation score (Phase 4)
const VALIDATION_SCORE_CLEAN  = 1.0;
const VALIDATION_SCORE_ISSUES = 0.7;

// ── In-memory caches ───────────────────────────────────────────────────────────
let _disabledStrategies = new Set();
let _strategyWeights    = new Map();   // strategy → weight
let _regimeMetrics      = new Map();   // "strategy::regime" → weighted_win_rate
let _confidenceAccuracy = new Map();   // strategy → accuracy_ratio
let _lastRun            = null;
let _lastReport         = null;        // stored for getLearningMetrics()

// ── Public fast accessors (O(1), safe in hot signal loops) ────────────────────

function getDisabledStrategies() { return _disabledStrategies; }

function getStrategyWeight(strategy) {
  return _strategyWeights.get(strategy) ?? 1.0;
}

/**
 * Returns the weighted win rate for a specific strategy+regime pair,
 * or null if fewer than MIN_REGIME_SAMPLE decided outcomes exist.
 */
function getRegimeWinRate(strategy, regime) {
  return _regimeMetrics.get(`${strategy}::${regime}`) ?? null;
}

/**
 * Returns the confidence accuracy ratio for a strategy, or null if
 * insufficient high-confidence outcomes have been evaluated.
 * < 1.0 = overconfident, > 1.0 = underconfident.
 */
function getConfidenceAccuracy(strategy) {
  return _confidenceAccuracy.get(strategy) ?? null;
}

// ── Recency and validation helpers ────────────────────────────────────────────

function getRecencyWeight(createdAt) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const dayMs = 24 * 3600_000;
  if (ageMs < dayMs)         return WEIGHT_0_1D;
  if (ageMs < 3 * dayMs)     return WEIGHT_1_3D;
  return WEIGHT_3_7D;
}

function getValidationScore(hadIssues) {
  return hadIssues ? VALIDATION_SCORE_ISSUES : VALIDATION_SCORE_CLEAN;
}

// ── Weight computation ─────────────────────────────────────────────────────────

/**
 * Maps a weighted win rate to an adaptive weight multiplier.
 * Requires at least MIN_SAMPLE_SIZE decided outcomes.
 */
function computeStrategyWeight(weightedDecided, weightedWinRate) {
  if (weightedDecided < MIN_SAMPLE_SIZE || weightedWinRate === null) return 1.0;
  return Math.max(0.5, Math.min(2.0, 1.0 + (weightedWinRate - 0.5) * 2.0));
}

// ── Core learning computation ──────────────────────────────────────────────────

/**
 * Fetches raw outcome rows and cross-references validation log to determine
 * had_validation_issues for rows that have not been explicitly flagged.
 */
async function fetchOutcomeRows() {
  // Fetch outcome rows + cross-check data_validation_log for validation quality
  const res = await queryWithTimeout(
    `SELECT
       so.setup_type,
       so.outcome,
       so.created_at,
       COALESCE(so.regime_trend, 'UNKNOWN')                              AS regime,
       so.predicted_confidence,
       COALESCE(
         so.had_validation_issues,
         EXISTS (
           SELECT 1 FROM data_validation_log dvl
           WHERE dvl.symbol = so.symbol
             AND dvl.created_at BETWEEN
               COALESCE(so.signal_ts, so.created_at) - INTERVAL '5 minutes'
               AND COALESCE(so.signal_ts, so.created_at) + INTERVAL '5 minutes'
         )
       )                                                                  AS had_validation_issues
     FROM signal_outcomes so
     WHERE so.created_at > NOW() - ($1 || ' days')::INTERVAL
       AND so.setup_type IS NOT NULL
       AND so.outcome IN ('WIN', 'LOSS')
     ORDER BY so.created_at DESC
     LIMIT 2000`,
    [String(LOOKBACK_DAYS)],
    { timeoutMs: 15000, label: 'learning.fetch_outcome_rows', maxRetries: 0 }
  );
  return res.rows || [];
}

/**
 * Main learning computation:
 *   - Applies recency + validation weights per row
 *   - Aggregates per strategy (overall) and per (strategy, regime)
 *   - Computes confidence accuracy from high-confidence outcomes
 */
function computeMetrics(rows) {
  // strategyData[strategy] = {
  //   raw_wins, raw_losses, weighted_wins, weighted_losses,
  //   highConfOutcomes: [{ confidence, isWin }]
  // }
  const strategyData = new Map();

  // regimeData["strategy::regime"] = {
  //   raw_wins, raw_losses, weighted_wins, weighted_losses
  // }
  const regimeData = new Map();

  for (const row of rows) {
    const strategy = row.setup_type;
    const regime   = row.regime || 'UNKNOWN';
    const isWin    = row.outcome === 'WIN';

    const recencyWeight    = getRecencyWeight(row.created_at);
    const validationScore  = getValidationScore(Boolean(row.had_validation_issues));
    const learningWeight   = recencyWeight * validationScore;

    // ── Overall strategy aggregation ─────────────────────────────────────
    if (!strategyData.has(strategy)) {
      strategyData.set(strategy, {
        raw_wins: 0, raw_losses: 0,
        weighted_wins: 0, weighted_losses: 0,
        highConfOutcomes: [],
      });
    }
    const sd = strategyData.get(strategy);
    if (isWin) {
      sd.raw_wins++;
      sd.weighted_wins += learningWeight;
    } else {
      sd.raw_losses++;
      sd.weighted_losses += learningWeight;
    }

    if (row.predicted_confidence != null) {
      sd.highConfOutcomes.push({
        confidence: Number(row.predicted_confidence),
        isWin,
      });
    }

    // ── Per-regime aggregation ────────────────────────────────────────────
    const regimeKey = `${strategy}::${regime}`;
    if (!regimeData.has(regimeKey)) {
      regimeData.set(regimeKey, {
        strategy, regime,
        raw_wins: 0, raw_losses: 0,
        weighted_wins: 0, weighted_losses: 0,
      });
    }
    const rd = regimeData.get(regimeKey);
    if (isWin) {
      rd.raw_wins++;
      rd.weighted_wins += learningWeight;
    } else {
      rd.raw_losses++;
      rd.weighted_losses += learningWeight;
    }
  }

  // ── Compute derived rates ───────────────────────────────────────────────
  const strategyStats = new Map();
  for (const [strategy, sd] of strategyData) {
    const rawDecided      = sd.raw_wins + sd.raw_losses;
    const weightedDecided = sd.weighted_wins + sd.weighted_losses;
    const raw_win_rate    = rawDecided > 0 ? sd.raw_wins / rawDecided : null;
    const weighted_win_rate =
      weightedDecided > 0 ? sd.weighted_wins / weightedDecided : null;

    // Confidence accuracy (Phase 5)
    const hcAll   = sd.highConfOutcomes.filter(o => o.confidence > 70);
    const hcWins  = hcAll.filter(o => o.isWin).length;
    let confidence_accuracy = null;
    if (hcAll.length >= MIN_CONF_FEEDBACK) {
      const actualWinRate  = hcWins / hcAll.length;
      const avgConfidence  = hcAll.reduce((s, o) => s + o.confidence, 0) / hcAll.length;
      const expectedWinRate = avgConfidence / 100;
      confidence_accuracy = expectedWinRate > 0
        ? Number((actualWinRate / expectedWinRate).toFixed(4))
        : null;
    }

    strategyStats.set(strategy, {
      raw_wins:       sd.raw_wins,
      raw_losses:     sd.raw_losses,
      raw_win_rate,
      weighted_wins:  sd.weighted_wins,
      weighted_losses: sd.weighted_losses,
      weighted_win_rate,
      decided:        rawDecided,
      weight:         computeStrategyWeight(weightedDecided, weighted_win_rate),
      confidence_accuracy,
      high_conf_sample: hcAll.length,
    });
  }

  const regimeStats = new Map();
  for (const [key, rd] of regimeData) {
    const rawDecided       = rd.raw_wins + rd.raw_losses;
    const weightedDecided  = rd.weighted_wins + rd.weighted_losses;
    regimeStats.set(key, {
      ...rd,
      raw_win_rate:       rawDecided > 0 ? rd.raw_wins / rawDecided : null,
      weighted_win_rate:  weightedDecided > 0 ? rd.weighted_wins / weightedDecided : null,
      sample_size:        rawDecided,
    });
  }

  return { strategyStats, regimeStats };
}

// ── DB write ───────────────────────────────────────────────────────────────────

async function upsertStrategyMetrics(strategy, stats, status) {
  const winRateVal        = stats.weighted_win_rate  !== null ? Number(stats.weighted_win_rate.toFixed(4))  : null;
  const rawWinRateVal     = stats.raw_win_rate        !== null ? Number(stats.raw_win_rate.toFixed(4))       : null;
  const falseSignalRate   = winRateVal                !== null ? Number((1 - winRateVal).toFixed(4))          : null;
  const edgeScore         = winRateVal                !== null ? Number(((winRateVal - 0.5) * 100).toFixed(2)) : null;
  const learningScore     = winRateVal                !== null ? Number((winRateVal * stats.weight * 100).toFixed(2)) : null;
  const confAccuracy      = stats.confidence_accuracy !== null ? Number(stats.confidence_accuracy.toFixed(4)) : null;

  await queryWithTimeout(
    `INSERT INTO strategy_learning_metrics
       (strategy, signals_count, win_rate, avg_return, median_return, max_return,
        false_signal_rate, edge_score, learning_score,
        weight, status, sample_size, last_evaluated_at, updated_at,
        weighted_win_rate, recency_adjusted, validation_adjusted, confidence_accuracy)
     VALUES ($1,$2,$3,NULL,NULL,NULL,$4,$5,$6,$7,$8,$9,NOW(),NOW(),$10,TRUE,TRUE,$11)
     ON CONFLICT (strategy) DO UPDATE SET
       signals_count       = EXCLUDED.signals_count,
       win_rate            = EXCLUDED.win_rate,
       false_signal_rate   = EXCLUDED.false_signal_rate,
       edge_score          = EXCLUDED.edge_score,
       learning_score      = EXCLUDED.learning_score,
       weight              = EXCLUDED.weight,
       status              = EXCLUDED.status,
       sample_size         = EXCLUDED.sample_size,
       last_evaluated_at   = EXCLUDED.last_evaluated_at,
       updated_at          = NOW(),
       weighted_win_rate   = EXCLUDED.weighted_win_rate,
       recency_adjusted    = TRUE,
       validation_adjusted = TRUE,
       confidence_accuracy = EXCLUDED.confidence_accuracy`,
    [
      strategy,
      stats.raw_wins + stats.raw_losses,
      rawWinRateVal,
      falseSignalRate,
      edgeScore,
      learningScore,
      Number(stats.weight.toFixed(4)),
      status,
      stats.decided,
      winRateVal,
      confAccuracy,
    ],
    { timeoutMs: 5000, label: 'learning.upsert_strategy', maxRetries: 0 }
  );
}

async function upsertRegimeMetrics(regimeEntry) {
  const { strategy, regime, raw_wins, raw_losses, weighted_wins, weighted_losses,
    raw_win_rate, weighted_win_rate, sample_size } = regimeEntry;

  await queryWithTimeout(
    `INSERT INTO strategy_regime_metrics
       (strategy, regime, raw_wins, raw_losses, weighted_wins, weighted_losses,
        raw_win_rate, weighted_win_rate, sample_size, last_evaluated_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
     ON CONFLICT (strategy, regime) DO UPDATE SET
       raw_wins          = EXCLUDED.raw_wins,
       raw_losses        = EXCLUDED.raw_losses,
       weighted_wins     = EXCLUDED.weighted_wins,
       weighted_losses   = EXCLUDED.weighted_losses,
       raw_win_rate      = EXCLUDED.raw_win_rate,
       weighted_win_rate = EXCLUDED.weighted_win_rate,
       sample_size       = EXCLUDED.sample_size,
       last_evaluated_at = EXCLUDED.last_evaluated_at,
       updated_at        = NOW()`,
    [
      strategy, regime,
      raw_wins, raw_losses,
      Number(weighted_wins.toFixed(4)),
      Number(weighted_losses.toFixed(4)),
      raw_win_rate  !== null ? Number(raw_win_rate.toFixed(4))  : null,
      weighted_win_rate !== null ? Number(weighted_win_rate.toFixed(4)) : null,
      sample_size,
    ],
    { timeoutMs: 5000, label: 'learning.upsert_regime', maxRetries: 0 }
  );
}

// ── Core learning loop ─────────────────────────────────────────────────────────

async function updateLearningMetrics() {
  const rows = await fetchOutcomeRows();

  if (rows.length === 0) {
    console.log('[LEARNING] No outcome rows in window — caches unchanged');
    return { updated: 0, regime_rows: 0, disabled: 0, reenabled: 0 };
  }

  const { strategyStats, regimeStats } = computeMetrics(rows);

  // Work on copies — swap atomically at the end
  const newDisabled  = new Set(_disabledStrategies);
  const newWeights   = new Map(_strategyWeights);
  const newRegime    = new Map(_regimeMetrics);
  const newAccuracy  = new Map(_confidenceAccuracy);

  let updated    = 0;
  let regimeRows = 0;
  let disabled   = 0;
  let reenabled  = 0;
  const report   = { strategies: [] };

  // ── Per-strategy upsert ──────────────────────────────────────────────────
  for (const [strategy, stats] of strategyStats) {
    const hasSufficient = stats.decided >= MIN_SAMPLE_SIZE;
    let status = newDisabled.has(strategy) ? 'disabled' : 'active';

    if (hasSufficient && stats.weighted_win_rate !== null) {
      if (stats.weighted_win_rate < DISABLE_THRESHOLD && !newDisabled.has(strategy)) {
        newDisabled.add(strategy);
        status = 'disabled';
        disabled++;
        console.log(
          `[LEARNING] AUTO-DISABLED strategy="${strategy}" ` +
          `wwr=${(stats.weighted_win_rate * 100).toFixed(1)}% ` +
          `rwr=${stats.raw_win_rate !== null ? (stats.raw_win_rate * 100).toFixed(1) : '?'}% ` +
          `decided=${stats.decided}`
        );
      } else if (stats.weighted_win_rate >= REENABLE_THRESHOLD && newDisabled.has(strategy)) {
        newDisabled.delete(strategy);
        status = 'active';
        reenabled++;
        console.log(
          `[LEARNING] RE-ENABLED strategy="${strategy}" ` +
          `wwr=${(stats.weighted_win_rate * 100).toFixed(1)}% decided=${stats.decided}`
        );
      }
    }

    newWeights.set(strategy, stats.weight);
    if (stats.confidence_accuracy !== null) {
      newAccuracy.set(strategy, stats.confidence_accuracy);
    }

    await upsertStrategyMetrics(strategy, stats, status);
    updated++;

    report.strategies.push({
      strategy, status,
      raw_win_rate:      stats.raw_win_rate      !== null ? Number((stats.raw_win_rate * 100).toFixed(1)) : null,
      weighted_win_rate: stats.weighted_win_rate !== null ? Number((stats.weighted_win_rate * 100).toFixed(1)) : null,
      weight:     Number(stats.weight.toFixed(3)),
      decided:    stats.decided,
      conf_accuracy: stats.confidence_accuracy,
    });
  }

  // ── Per-regime upsert ────────────────────────────────────────────────────
  for (const [key, rs] of regimeStats) {
    // Update regime win-rate cache for O(1) reads in signal engines
    if (rs.sample_size >= MIN_REGIME_SAMPLE && rs.weighted_win_rate !== null) {
      newRegime.set(key, Number(rs.weighted_win_rate.toFixed(4)));
    }
    await upsertRegimeMetrics(rs);
    regimeRows++;
  }

  // Atomic cache swap
  _disabledStrategies = newDisabled;
  _strategyWeights    = newWeights;
  _regimeMetrics      = newRegime;
  _confidenceAccuracy = newAccuracy;
  _lastRun            = new Date().toISOString();
  _lastReport         = report;

  return { updated, regime_rows: regimeRows, disabled, reenabled };
}

// ── Health endpoint data ───────────────────────────────────────────────────────

async function getLearningMetrics() {
  try {
    // Overall strategy summary
    const slmRes = await queryWithTimeout(
      `SELECT strategy, win_rate, weighted_win_rate, weight, status,
              sample_size, confidence_accuracy, updated_at
       FROM strategy_learning_metrics
       ORDER BY COALESCE(weighted_win_rate, win_rate, 0) DESC`,
      [],
      { timeoutMs: 5000, label: 'learning.health_overall', maxRetries: 0 }
    );

    // Regime performance breakdown
    const srmRes = await queryWithTimeout(
      `SELECT strategy, regime, weighted_win_rate, raw_win_rate, sample_size
       FROM strategy_regime_metrics
       ORDER BY strategy, regime`,
      [],
      { timeoutMs: 5000, label: 'learning.health_regime', maxRetries: 0 }
    );

    const rows     = slmRes.rows || [];
    const active   = rows.filter(r => r.status === 'active');
    const disabledRows = rows.filter(r => r.status === 'disabled');
    const best     = active[0]                  ?? null;
    const worst    = active[active.length - 1]  ?? null;

    const avgWinRate = active.length > 0
      ? Number(
          (active.reduce((s, r) => s + Number(r.weighted_win_rate || r.win_rate || 0), 0) / active.length)
          .toFixed(3)
        )
      : null;

    // Group regime stats by strategy for the health payload
    const regimeByStrategy = {};
    for (const r of srmRes.rows || []) {
      if (!regimeByStrategy[r.strategy]) regimeByStrategy[r.strategy] = {};
      regimeByStrategy[r.strategy][r.regime] = {
        weighted_win_rate: r.weighted_win_rate !== null ? Number(Number(r.weighted_win_rate).toFixed(3)) : null,
        raw_win_rate:      r.raw_win_rate      !== null ? Number(Number(r.raw_win_rate).toFixed(3))      : null,
        sample_size:       Number(r.sample_size || 0),
      };
    }

    return {
      strategies_tracked:  rows.length,
      active_strategies:   active.length,
      disabled_strategies: disabledRows.map(r => r.strategy),
      best_strategy:  best  ? { name: best.strategy,  weighted_win_rate: Number(best.weighted_win_rate  || 0), weight: Number(best.weight  || 1) } : null,
      worst_strategy: worst ? { name: worst.strategy, weighted_win_rate: Number(worst.weighted_win_rate || 0), weight: Number(worst.weight || 1) } : null,
      avg_win_rate: avgWinRate,
      regime_breakdown: regimeByStrategy,
      last_run: _lastRun,
      last_report: _lastReport,
    };
  } catch (err) {
    console.warn('[LEARNING] getLearningMetrics failed:', err.message);
    return null;
  }
}

// ── Main entry point ───────────────────────────────────────────────────────────

async function runLearningEngine() {
  try {
    console.log('[LEARNING] Starting context-aware learning cycle...');
    const result = await updateLearningMetrics();
    console.log(
      `[LEARNING] Cycle complete — strategies=${result.updated} ` +
      `regime_rows=${result.regime_rows} ` +
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
  getRegimeWinRate,
  getConfidenceAccuracy,
  getLearningMetrics,
  // Exported for testing
  computeStrategyWeight,
  getRecencyWeight,
  getValidationScore,
};
