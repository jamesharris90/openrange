'use strict';

/**
 * System Score Engine
 *
 * Computes a 0–100 platform health score every 5 minutes.
 *
 * Weights:
 *   Evaluation rate      30%  — are signals being evaluated?
 *   Data freshness       25%  — how old is market_quotes?
 *   Error rate           20%  — signal eval errors (inverted)
 *   Signal consistency   15%  — signals logged in last 24h
 *   Engine uptime        10%  — last premarket_watchlist update
 *
 * Thresholds:
 *   ≥ 90 → OPERATIONAL
 *   70–89 → DEGRADED
 *   < 70 → CRITICAL
 */

const { queryWithTimeout } = require('../db/pg');

const LABEL      = '[SYSTEM_SCORE]';
const CACHE_TTL  = 5 * 60 * 1000; // 5 min

let _cache   = null;
let _cacheTs = 0;

async function computeSystemScore() {
  const now = Date.now();
  if (_cache && (now - _cacheTs) < CACHE_TTL) return _cache;

  const [evalRes, freshnessRes, errRes, sigRes, engineRes] = await Promise.all([

    // Evaluation rate (30pts)
    queryWithTimeout(
      `SELECT
         COUNT(*) FILTER (WHERE evaluated = true AND timestamp >= NOW() - INTERVAL '24 hours') AS evaluated,
         COUNT(*) FILTER (WHERE timestamp < NOW() - INTERVAL '5 minutes')                       AS eligible
       FROM signal_log`,
      [], { timeoutMs: 8000, label: 'score.eval' }
    ).catch(() => ({ rows: [{ evaluated: 0, eligible: 0 }] })),

    // Data freshness — market_quotes age (25pts)
    queryWithTimeout(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(updated_at))) / 60 AS age_minutes FROM market_quotes`,
      [], { timeoutMs: 8000, label: 'score.freshness' }
    ).catch(() => ({ rows: [{ age_minutes: 9999 }] })),

    // Error rate — signal eval errors (20pts, inverted)
    queryWithTimeout(
      `SELECT COUNT(*) AS errors FROM signal_log WHERE outcome = 'ERROR' AND timestamp >= NOW() - INTERVAL '24 hours'`,
      [], { timeoutMs: 8000, label: 'score.errors' }
    ).catch(() => ({ rows: [{ errors: 0 }] })),

    // Signal consistency (15pts)
    queryWithTimeout(
      `SELECT COUNT(*) AS signals_24h FROM signal_log WHERE timestamp >= NOW() - INTERVAL '24 hours'`,
      [], { timeoutMs: 8000, label: 'score.signals' }
    ).catch(() => ({ rows: [{ signals_24h: 0 }] })),

    // Engine uptime — premarket_watchlist freshness (10pts)
    queryWithTimeout(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(updated_at))) / 60 AS age_minutes FROM premarket_watchlist`,
      [], { timeoutMs: 5000, label: 'score.engine' }
    ).catch(() => ({ rows: [{ age_minutes: 9999 }] })),
  ]);

  // ── Component scores (each 0–100) ────────────────────────────────────────
  const eligible   = Math.max(Number(evalRes.rows[0]?.eligible   || 0), 1);
  const evaluated  = Number(evalRes.rows[0]?.evaluated || 0);
  const evalScore  = Math.min(100, Math.round((evaluated / eligible) * 100));

  const mktAge     = Number(freshnessRes.rows[0]?.age_minutes || 9999);
  const freshScore = mktAge < 60  ? 100
                   : mktAge < 240 ? Math.round(100 - ((mktAge - 60) / 180 * 50))
                   : mktAge < 1440 ? Math.round(50 - ((mktAge - 240) / 1200 * 50))
                   : 0;

  const errors24h  = Number(errRes.rows[0]?.errors || 0);
  const errorScore = Math.max(0, Math.round(100 - (errors24h * 10)));

  const sig24h     = Number(sigRes.rows[0]?.signals_24h || 0);
  const sigScore   = sig24h >= 50 ? 100
                   : sig24h >= 10 ? Math.round(sig24h / 50 * 100)
                   : Math.round(sig24h / 10 * 40);

  const engAge     = Number(engineRes.rows[0]?.age_minutes || 9999);
  const engScore   = engAge < 15  ? 100
                   : engAge < 60  ? Math.round(100 - ((engAge - 15) / 45 * 50))
                   : engAge < 120 ? Math.round(50 - ((engAge - 60) / 60 * 50))
                   : 0;

  // ── Weighted total ────────────────────────────────────────────────────────
  const score = Math.round(
    (evalScore  * 0.30) +
    (freshScore * 0.25) +
    (errorScore * 0.20) +
    (sigScore   * 0.15) +
    (engScore   * 0.10)
  );

  const finalScore = Math.max(0, Math.min(100, score));
  const status     = finalScore >= 90 ? 'OPERATIONAL' : finalScore >= 70 ? 'DEGRADED' : 'CRITICAL';

  _cache = {
    score:  finalScore,
    status,
    components: {
      evaluation_rate:      evalScore,
      data_freshness:       freshScore,
      error_rate:           errorScore,
      signal_consistency:   sigScore,
      engine_uptime:        engScore,
    },
    raw: {
      eval_evaluated: evaluated,
      eval_eligible:  Number(evalRes.rows[0]?.eligible || 0),
      market_age_minutes: mktAge,
      errors_24h:  errors24h,
      signals_24h: sig24h,
      engine_age_minutes: engAge,
    },
    generated_at: new Date().toISOString(),
  };
  _cacheTs = now;

  console.log(`${LABEL} score=${finalScore} status=${status} (eval=${evalScore} fresh=${freshScore} err=${errorScore} sig=${sigScore} eng=${engScore})`);
  return _cache;
}

function getCachedScore() {
  return _cache ?? { score: null, status: 'UNKNOWN', components: {}, generated_at: null };
}

module.exports = { computeSystemScore, getCachedScore };
