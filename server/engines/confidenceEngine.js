'use strict';

/**
 * Confidence Engine
 *
 * Dynamically computes a per-signal confidence score (0–100) from four inputs:
 *   1. Historical strategy win rate (signal_outcomes, last 7 days)
 *   2. Validation quality (issues on the row)
 *   3. Provider reliability (FMP cross-check rejection rate)
 *   4. Market regime (trend + volatility from marketRegimeEngine)
 *
 * Returns both a final value and a full breakdown for transparency.
 */

const { queryWithTimeout } = require('../db/pg');

// ── Simple TTL cache ──────────────────────────────────────────────────────────

class TtlCache {
  constructor(ttlMs) {
    this._map = new Map();
    this._ttl = ttlMs;
  }
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this._ttl) { this._map.delete(key); return undefined; }
    return entry.val;
  }
  set(key, val) { this._map.set(key, { val, ts: Date.now() }); }
}

const strategyCache  = new TtlCache(5 * 60 * 1000);  // 5-min TTL
const providerCache  = new TtlCache(2 * 60 * 1000);  // 2-min TTL

// ── Strategy win-rate source ──────────────────────────────────────────────────

/**
 * Fetches win/loss statistics for a strategy over the last 7 days.
 * Returns null if fewer than 3 evaluated outcomes exist (insufficient signal).
 */
async function getStrategyStats(setupType) {
  if (!setupType) return null;

  const cached = strategyCache.get(setupType);
  if (cached !== undefined) return cached;

  try {
    const res = await queryWithTimeout(
      `SELECT
         COUNT(*) FILTER (WHERE outcome = 'WIN')::int  AS wins,
         COUNT(*) FILTER (WHERE outcome = 'LOSS')::int AS losses,
         COUNT(*) FILTER (WHERE outcome IS NOT NULL)::int AS evaluated
       FROM signal_outcomes
       WHERE setup_type = $1
         AND created_at > NOW() - INTERVAL '7 days'`,
      [setupType],
      { timeoutMs: 5000, label: 'confidence.strategy_stats', maxRetries: 0 }
    );

    const row = res.rows?.[0];
    if (!row) { strategyCache.set(setupType, null); return null; }

    const wins      = Number(row.wins      || 0);
    const losses    = Number(row.losses    || 0);
    const evaluated = Number(row.evaluated || 0);

    // Require at least 3 evaluated outcomes before adjusting confidence
    if (evaluated < 3) { strategyCache.set(setupType, null); return null; }

    const decided  = wins + losses; // exclude NEUTRAL from win_rate denominator
    const win_rate = decided > 0 ? wins / decided : 0.5;

    const result = { wins, losses, evaluated, win_rate };
    strategyCache.set(setupType, result);
    return result;
  } catch (err) {
    console.warn('[CONFIDENCE] strategy stats query failed:', err.message);
    strategyCache.set(setupType, null);
    return null;
  }
}

// ── Provider reliability ──────────────────────────────────────────────────────

async function getProviderScore() {
  const cached = providerCache.get('fmp');
  if (cached !== undefined) return cached;

  try {
    const { getValidationReliability } = require('./providerHealthEngine');
    const result = await getValidationReliability('fmp', 24);
    const score  = result?.reliability_score ?? 1.0;
    providerCache.set('fmp', score);
    return score;
  } catch {
    providerCache.set('fmp', 1.0);
    return 1.0;
  }
}

// ── Core confidence computation ───────────────────────────────────────────────

/**
 * Computes confidence for a single signal.
 *
 * @param {object} signal
 *   @param {string} signal.setup_type       Strategy name (e.g. 'Gap & Go')
 *   @param {Array}  [signal.validation_issues=[]] Issues from validateAndEnrich
 *   @param {string} [signal.market_regime]  Override; falls back to getCurrentRegime()
 *
 * @returns {{ value: number, breakdown: object }}
 *   value: integer 0–100
 *   breakdown: per-component adjustments
 */
async function computeConfidence(signal) {
  let confidence = 50; // baseline

  const breakdown = {
    base:                 50,
    strategy_edge:        0,
    validation_penalty:   0,
    provider_adjustment:  0,
    regime_adjustment:    0,
  };

  // ── 1. Strategy historical edge ───────────────────────────────────────────
  const stats = await getStrategyStats(signal.setup_type);
  if (stats) {
    const edge = (stats.win_rate - 0.5) * 100; // +/- 50 max swing
    confidence += edge;
    breakdown.strategy_edge = Number(edge.toFixed(2));
    breakdown.strategy_stats = {
      wins:      stats.wins,
      losses:    stats.losses,
      win_rate:  Number((stats.win_rate * 100).toFixed(1)),
      evaluated: stats.evaluated,
    };
  }

  // ── 1b. Learning engine weight multiplier ────────────────────────────────
  // Applies the adaptive per-strategy weight computed by learningEngine.
  // Weight 1.0 = neutral (no data yet); >1 = strong history; <1 = poor history.
  try {
    const { getStrategyWeight } = require('./learningEngine');
    const weight = getStrategyWeight(signal.setup_type);
    if (weight !== 1.0) {
      const before = confidence;
      confidence   = confidence * weight;
      breakdown.learning_weight     = Number(weight.toFixed(3));
      breakdown.learning_adjustment = Number((confidence - before).toFixed(2));
    }
  } catch { /* learningEngine not yet loaded */ }

  // ── 2. Validation quality ─────────────────────────────────────────────────
  const issues = signal.validation_issues || [];
  if (issues.length > 0) {
    confidence -= 20;
    breakdown.validation_penalty = -20;
    breakdown.validation_issues  = issues;
  }

  // ── 3. Provider reliability ───────────────────────────────────────────────
  const providerScore = await getProviderScore();
  if (providerScore < 1.0) {
    const before = confidence;
    confidence   = confidence * providerScore;
    breakdown.provider_adjustment = Number((confidence - before).toFixed(2));
  }
  breakdown.provider_reliability = Number(providerScore.toFixed(4));

  // ── 4. Market regime ──────────────────────────────────────────────────────
  let regime = null;
  try {
    // Prefer explicitly passed regime; fall back to in-process cache
    if (signal.market_regime) {
      regime = { trend: signal.market_regime };
    } else {
      const { getCurrentRegime } = require('../services/marketRegimeEngine');
      regime = getCurrentRegime();
    }
  } catch { /* no regime available */ }

  if (regime) {
    if (regime.trend === 'BEAR') {
      confidence -= 10;
      breakdown.regime_adjustment -= 10;
    }
    if (regime.volatility === 'HIGH') {
      confidence -= 5;
      breakdown.regime_adjustment -= 5;
    }
    breakdown.regime = { trend: regime.trend, volatility: regime.volatility };
  }

  const value = Math.max(0, Math.min(100, Math.round(confidence)));
  breakdown.final = value;

  return { value, breakdown };
}

// ── Confidence metrics for health endpoint ────────────────────────────────────

/**
 * Queries strategy_signals for confidence distribution metrics.
 * Non-blocking — returns nulls on error.
 */
async function getConfidenceMetrics() {
  try {
    const res = await queryWithTimeout(
      `SELECT
         ROUND(AVG(confidence), 1)::float                             AS avg_confidence,
         COUNT(*) FILTER (WHERE confidence > 70)::int                 AS high_confidence,
         COUNT(*) FILTER (WHERE confidence < 40)::int                 AS low_confidence,
         COUNT(*) FILTER (WHERE confidence BETWEEN 40 AND 70)::int    AS mid_confidence,
         COUNT(*) FILTER (WHERE confidence IS NOT NULL)::int          AS total_with_confidence
       FROM strategy_signals
       WHERE updated_at > NOW() - INTERVAL '24 hours'`,
      [],
      { timeoutMs: 5000, label: 'confidence.metrics', maxRetries: 0 }
    );
    const row = res.rows?.[0] || {};
    return {
      avg_confidence:         Number(row.avg_confidence   || 0),
      high_confidence_signals: Number(row.high_confidence || 0),
      low_confidence_signals:  Number(row.low_confidence  || 0),
      mid_confidence_signals:  Number(row.mid_confidence  || 0),
      total_with_confidence:   Number(row.total_with_confidence || 0),
    };
  } catch (err) {
    console.warn('[CONFIDENCE] metrics query failed:', err.message);
    return null;
  }
}

module.exports = {
  computeConfidence,
  getStrategyStats,
  getConfidenceMetrics,
};
