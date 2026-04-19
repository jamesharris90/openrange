const { queryWithTimeout, runWithDbPool } = require('../db/pg');
const {
  PARAMS_HISTORY_TABLE,
  PARAMS_TABLE,
  clearStrategyParamsCache,
  ensureBeaconNightlyTables,
  getStrategyParamsMap,
} = require('./paramsCache');

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildTunedValues(existing, stats) {
  const next = {
    enabled: existing.enabled !== false,
    min_grade_score: existing.min_grade_score,
    min_win_rate: existing.min_win_rate,
    min_profit_factor: existing.min_profit_factor,
    confidence_multiplier: existing.confidence_multiplier,
    max_picks_per_run: existing.max_picks_per_run,
    hold_days: existing.hold_days,
    evaluation_lookback: existing.evaluation_lookback,
    metadata: {
      ...(existing.metadata || {}),
      adaptive_metrics: {
        sample_size: stats.sample_size,
        win_rate: stats.win_rate,
        avg_r: stats.avg_r,
        updated_at: new Date().toISOString(),
      },
    },
  };

  let reason = 'unchanged';
  if (stats.sample_size >= 5 && (stats.win_rate < 0.35 || stats.avg_r <= -0.25)) {
    next.min_grade_score = 100;
    next.min_profit_factor = 1.5;
    next.confidence_multiplier = 0.85;
    next.max_picks_per_run = 1;
    reason = 'de-risk_underperforming_strategy';
  } else if (stats.sample_size >= 5 && stats.win_rate >= 0.6 && stats.avg_r >= 0.25) {
    next.min_grade_score = 70;
    next.min_profit_factor = 1.1;
    next.confidence_multiplier = 1.15;
    next.max_picks_per_run = 3;
    reason = 'promote_outperforming_strategy';
  } else if (stats.sample_size >= 5) {
    next.min_grade_score = 85;
    next.min_profit_factor = 1.25;
    next.confidence_multiplier = 1;
    next.max_picks_per_run = 2;
    reason = 'normalize_strategy_thresholds';
  }

  next.confidence_multiplier = roundTo(next.confidence_multiplier, 2);
  return { next, reason };
}

function paramsChanged(existing, next) {
  return [
    'enabled',
    'min_grade_score',
    'min_win_rate',
    'min_profit_factor',
    'confidence_multiplier',
    'max_picks_per_run',
    'hold_days',
    'evaluation_lookback',
  ].some((key) => JSON.stringify(existing[key]) !== JSON.stringify(next[key]));
}

async function loadRecentStats() {
  const result = await queryWithTimeout(
    `WITH ranked AS (
       SELECT
         strategy_id,
         evaluation_status,
         actual_pnl_r,
         ROW_NUMBER() OVER (
           PARTITION BY strategy_id
           ORDER BY evaluated_at DESC, created_at DESC
         ) AS rn
       FROM beacon_pick_outcomes
       WHERE evaluation_status IN ('win', 'loss', 'flat')
     )
     SELECT
       strategy_id,
       COUNT(*)::int AS sample_size,
       AVG(CASE WHEN evaluation_status = 'win' THEN 1 ELSE 0 END)::numeric AS win_rate,
       AVG(actual_pnl_r)::numeric AS avg_r
     FROM ranked
     WHERE rn <= 12
     GROUP BY strategy_id`,
    [],
    {
      timeoutMs: 20000,
      label: 'beacon_nightly.tuner.stats',
      maxRetries: 0,
    }
  );

  return new Map((result.rows || []).map((row) => [
    String(row.strategy_id || '').trim(),
    {
      sample_size: Number(row.sample_size || 0),
      win_rate: toNumber(row.win_rate, 0),
      avg_r: toNumber(row.avg_r, 0),
    },
  ]));
}

async function persistParamChange(strategyId, existing, next, reason, runId) {
  await runWithDbPool('write', () => queryWithTimeout(
    `UPDATE ${PARAMS_TABLE}
     SET enabled = $2,
         min_grade_score = $3,
         min_win_rate = $4,
         min_profit_factor = $5,
         confidence_multiplier = $6,
         max_picks_per_run = $7,
         hold_days = $8,
         evaluation_lookback = $9,
         updated_at = NOW(),
         metadata = $10::jsonb
     WHERE strategy_id = $1`,
    [
      strategyId,
      next.enabled,
      next.min_grade_score,
      next.min_win_rate,
      next.min_profit_factor,
      next.confidence_multiplier,
      next.max_picks_per_run,
      next.hold_days,
      next.evaluation_lookback,
      JSON.stringify(next.metadata || {}),
    ],
    {
      timeoutMs: 10000,
      label: `beacon_nightly.tuner.update.${strategyId}`,
      maxRetries: 1,
      poolType: 'write',
    }
  ));

  await runWithDbPool('write', () => queryWithTimeout(
    `INSERT INTO ${PARAMS_HISTORY_TABLE} (
       strategy_id,
       reason,
       source_run_id,
       previous_params,
       next_params
     )
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [
      strategyId,
      reason,
      runId || null,
      JSON.stringify(existing),
      JSON.stringify(next),
    ],
    {
      timeoutMs: 10000,
      label: `beacon_nightly.tuner.history.${strategyId}`,
      maxRetries: 1,
      poolType: 'write',
    }
  ));
}

async function tuneStrategyParams(options = {}) {
  await ensureBeaconNightlyTables();
  const paramsMap = await getStrategyParamsMap({ refresh: true });
  const statsMap = await loadRecentStats();
  const changed = [];

  for (const [strategyId, existing] of paramsMap.entries()) {
    const stats = statsMap.get(strategyId) || { sample_size: 0, win_rate: 0, avg_r: 0 };
    const { next, reason } = buildTunedValues(existing, stats);
    if (!paramsChanged(existing, next)) {
      continue;
    }

    await persistParamChange(strategyId, existing, next, reason, options.runId);
    changed.push({
      strategy_id: strategyId,
      reason,
      sample_size: stats.sample_size,
      win_rate: roundTo(stats.win_rate, 4),
      avg_r: roundTo(stats.avg_r, 4),
      next,
    });
  }

  if (changed.length) {
    clearStrategyParamsCache();
  }

  return {
    tuned_strategy_count: changed.length,
    changes: changed,
  };
}

module.exports = {
  tuneStrategyParams,
};