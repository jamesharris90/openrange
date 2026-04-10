const { queryWithTimeout } = require('../db/pg');

const CACHE_TTL_MS = 5 * 60 * 1000;

let cacheValue = {
  catalyst_weights: {},
  confidence_weights: {
    '90-100': 0.5,
    '80-90': 0.5,
    '70-80': 0.5,
  },
};
let cacheExpiresAt = 0;
let refreshInFlight = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toWeight(value, fallback = 0.5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return clamp(num, 0, 1);
}

function defaultWeights() {
  return {
    catalyst_weights: {},
    confidence_weights: {
      '90-100': 0.5,
      '80-90': 0.5,
      '70-80': 0.5,
    },
  };
}

async function loadPerformanceWeightsFromDb() {
  const weights = defaultWeights();

  const [catalystResult, confidenceResult] = await Promise.all([
    queryWithTimeout(
      `SELECT
         COALESCE(NULLIF(UPPER(catalyst_type), ''), 'UNKNOWN') AS catalyst_type,
         COUNT(*)::int AS total,
         AVG(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::float8 AS win_rate
       FROM backtest_signals
       WHERE evaluated = true
       GROUP BY COALESCE(NULLIF(UPPER(catalyst_type), ''), 'UNKNOWN')`,
      [],
      {
        timeoutMs: 1200,
        maxRetries: 0,
        slowQueryMs: 600,
        label: 'services.performance_cache.catalyst_weights',
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT
         bucket,
         COUNT(*)::int AS total,
         AVG(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::float8 AS win_rate
       FROM (
         SELECT
           CASE
             WHEN confidence >= 90 THEN '90-100'
             WHEN confidence >= 80 THEN '80-90'
             WHEN confidence >= 70 THEN '70-80'
             ELSE NULL
           END AS bucket,
           result
         FROM backtest_signals
         WHERE evaluated = true
       ) ranked
       WHERE bucket IS NOT NULL
       GROUP BY bucket`,
      [],
      {
        timeoutMs: 1200,
        maxRetries: 0,
        slowQueryMs: 600,
        label: 'services.performance_cache.confidence_weights',
      }
    ).catch(() => ({ rows: [] })),
  ]);

  for (const row of catalystResult.rows || []) {
    const key = String(row.catalyst_type || '').trim().toUpperCase();
    if (!key) continue;
    weights.catalyst_weights[key] = toWeight(row.win_rate);
  }

  for (const row of confidenceResult.rows || []) {
    const key = String(row.bucket || '').trim();
    if (!weights.confidence_weights[key]) continue;
    weights.confidence_weights[key] = toWeight(row.win_rate);
  }

  return weights;
}

function refreshWeightsInBackground() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = loadPerformanceWeightsFromDb()
    .then((weights) => {
      cacheValue = weights;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return cacheValue;
    })
    .catch(() => cacheValue)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

async function getPerformanceWeights() {
  if (Date.now() < cacheExpiresAt) {
    return cacheValue;
  }

  refreshWeightsInBackground();
  return cacheValue;
}

module.exports = {
  getPerformanceWeights,
};
