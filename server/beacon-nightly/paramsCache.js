const { queryWithTimeout, runWithDbPool } = require('../db/pg');
const { loadStrategyModules } = require('../backtester/strategyLoader');

const PARAMS_TABLE = 'beacon_strategy_params';
const PARAMS_HISTORY_TABLE = 'beacon_strategy_params_history';
const OUTCOMES_TABLE = 'beacon_pick_outcomes';
const RUNS_TABLE = 'beacon_nightly_runs';

const DEFAULT_PARAM_VALUES = Object.freeze({
  enabled: true,
  min_grade_score: 85,
  min_win_rate: null,
  min_profit_factor: null,
  confidence_multiplier: 1,
  max_picks_per_run: 2,
  hold_days: 1,
  evaluation_lookback: 12,
});

const CACHE_TTL_MS = 60 * 1000;

let ensureTablesPromise = null;
let paramsCache = null;

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildDefaultParamRow(strategy) {
  const holdPeriod = Number(strategy?.holdPeriod);
  const holdDays = Number.isFinite(holdPeriod) && holdPeriod > 0 ? Math.max(1, Math.round(holdPeriod)) : DEFAULT_PARAM_VALUES.hold_days;

  return {
    strategy_id: strategy.id,
    enabled: DEFAULT_PARAM_VALUES.enabled,
    min_grade_score: DEFAULT_PARAM_VALUES.min_grade_score,
    min_win_rate: DEFAULT_PARAM_VALUES.min_win_rate,
    min_profit_factor: DEFAULT_PARAM_VALUES.min_profit_factor,
    confidence_multiplier: DEFAULT_PARAM_VALUES.confidence_multiplier,
    max_picks_per_run: DEFAULT_PARAM_VALUES.max_picks_per_run,
    hold_days: holdDays,
    evaluation_lookback: DEFAULT_PARAM_VALUES.evaluation_lookback,
    metadata: {
      strategy_name: strategy.name,
      timeframe: strategy.timeframe,
      category: strategy.category,
      data_required: strategy.dataRequired,
      seeded_by: 'beacon-nightly',
    },
  };
}

async function ensureBeaconNightlyTables() {
  if (!ensureTablesPromise) {
    ensureTablesPromise = runWithDbPool('write', async () => {
      await queryWithTimeout(
        `CREATE TABLE IF NOT EXISTS ${OUTCOMES_TABLE} (
           pick_id UUID PRIMARY KEY,
           pick_date DATE NOT NULL,
           strategy_id TEXT NOT NULL,
           symbol TEXT NOT NULL,
           evaluation_status TEXT NOT NULL,
           entry_triggered BOOLEAN NOT NULL DEFAULT false,
           actual_entry_price NUMERIC,
           exit_price NUMERIC,
           actual_pnl_r NUMERIC,
           bars_held INTEGER,
           exit_reason TEXT,
           evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           metadata JSONB NOT NULL DEFAULT '{}'::jsonb
         )`,
        [],
        {
          timeoutMs: 20000,
          label: 'beacon_nightly.ensure.outcomes',
          maxRetries: 1,
          poolType: 'write',
        }
      );

      await queryWithTimeout(
        `CREATE INDEX IF NOT EXISTS idx_${OUTCOMES_TABLE}_strategy_date
         ON ${OUTCOMES_TABLE} (strategy_id, pick_date DESC)`,
        [],
        {
          timeoutMs: 20000,
          label: 'beacon_nightly.ensure.outcomes_index',
          maxRetries: 1,
          poolType: 'write',
        }
      );

      await queryWithTimeout(
        `CREATE TABLE IF NOT EXISTS ${PARAMS_TABLE} (
           strategy_id TEXT PRIMARY KEY,
           enabled BOOLEAN NOT NULL DEFAULT true,
           min_grade_score INTEGER NOT NULL DEFAULT 85,
           min_win_rate NUMERIC,
           min_profit_factor NUMERIC,
           confidence_multiplier NUMERIC NOT NULL DEFAULT 1,
           max_picks_per_run INTEGER NOT NULL DEFAULT 2,
           hold_days INTEGER NOT NULL DEFAULT 1,
           evaluation_lookback INTEGER NOT NULL DEFAULT 12,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           metadata JSONB NOT NULL DEFAULT '{}'::jsonb
         )`,
        [],
        {
          timeoutMs: 20000,
          label: 'beacon_nightly.ensure.params',
          maxRetries: 1,
          poolType: 'write',
        }
      );

      await queryWithTimeout(
        `CREATE TABLE IF NOT EXISTS ${PARAMS_HISTORY_TABLE} (
           id BIGSERIAL PRIMARY KEY,
           strategy_id TEXT NOT NULL,
           reason TEXT NOT NULL,
           source_run_id BIGINT,
           previous_params JSONB NOT NULL,
           next_params JSONB NOT NULL,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`,
        [],
        {
          timeoutMs: 20000,
          label: 'beacon_nightly.ensure.params_history',
          maxRetries: 1,
          poolType: 'write',
        }
      );

      await queryWithTimeout(
        `CREATE INDEX IF NOT EXISTS idx_${PARAMS_HISTORY_TABLE}_strategy_created
         ON ${PARAMS_HISTORY_TABLE} (strategy_id, created_at DESC)`,
        [],
        {
          timeoutMs: 20000,
          label: 'beacon_nightly.ensure.params_history_index',
          maxRetries: 1,
          poolType: 'write',
        }
      );

      await queryWithTimeout(
        `CREATE TABLE IF NOT EXISTS ${RUNS_TABLE} (
           id BIGSERIAL PRIMARY KEY,
           run_type TEXT NOT NULL DEFAULT 'nightly',
           status TEXT NOT NULL,
           started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           completed_at TIMESTAMPTZ,
           evaluated_pick_count INTEGER NOT NULL DEFAULT 0,
           tuned_strategy_count INTEGER NOT NULL DEFAULT 0,
           generated_pick_count INTEGER NOT NULL DEFAULT 0,
           score_rows INTEGER NOT NULL DEFAULT 0,
           signal_rows INTEGER NOT NULL DEFAULT 0,
           error TEXT,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           metadata JSONB NOT NULL DEFAULT '{}'::jsonb
         )`,
        [],
        {
          timeoutMs: 20000,
          label: 'beacon_nightly.ensure.runs',
          maxRetries: 1,
          poolType: 'write',
        }
      );

      await queryWithTimeout(
        `CREATE INDEX IF NOT EXISTS idx_${RUNS_TABLE}_started_at
         ON ${RUNS_TABLE} (started_at DESC)`,
        [],
        {
          timeoutMs: 20000,
          label: 'beacon_nightly.ensure.runs_index',
          maxRetries: 1,
          poolType: 'write',
        }
      );
    }).catch((error) => {
      ensureTablesPromise = null;
      throw error;
    });
  }

  return ensureTablesPromise;
}

async function seedDefaultStrategyParams() {
  await ensureBeaconNightlyTables();

  const strategies = loadStrategyModules();
  for (const strategy of strategies) {
    const defaults = buildDefaultParamRow(strategy);
    await runWithDbPool('write', () => queryWithTimeout(
      `INSERT INTO ${PARAMS_TABLE} (
         strategy_id,
         enabled,
         min_grade_score,
         min_win_rate,
         min_profit_factor,
         confidence_multiplier,
         max_picks_per_run,
         hold_days,
         evaluation_lookback,
         updated_at,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10::jsonb)
       ON CONFLICT (strategy_id) DO NOTHING`,
      [
        defaults.strategy_id,
        defaults.enabled,
        defaults.min_grade_score,
        defaults.min_win_rate,
        defaults.min_profit_factor,
        defaults.confidence_multiplier,
        defaults.max_picks_per_run,
        defaults.hold_days,
        defaults.evaluation_lookback,
        JSON.stringify(defaults.metadata),
      ],
      {
        timeoutMs: 10000,
        label: `beacon_nightly.seed.${defaults.strategy_id}`,
        maxRetries: 1,
        poolType: 'write',
      }
    ));
  }

  clearStrategyParamsCache();
  return strategies.length;
}

function normalizeParamRow(row = {}) {
  return {
    strategy_id: String(row.strategy_id || '').trim(),
    enabled: row.enabled !== false,
    min_grade_score: Math.max(0, Math.round(toNumber(row.min_grade_score, DEFAULT_PARAM_VALUES.min_grade_score))),
    min_win_rate: toNumber(row.min_win_rate),
    min_profit_factor: toNumber(row.min_profit_factor),
    confidence_multiplier: toNumber(row.confidence_multiplier, DEFAULT_PARAM_VALUES.confidence_multiplier),
    max_picks_per_run: Math.max(1, Math.round(toNumber(row.max_picks_per_run, DEFAULT_PARAM_VALUES.max_picks_per_run))),
    hold_days: Math.max(1, Math.round(toNumber(row.hold_days, DEFAULT_PARAM_VALUES.hold_days))),
    evaluation_lookback: Math.max(1, Math.round(toNumber(row.evaluation_lookback, DEFAULT_PARAM_VALUES.evaluation_lookback))),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    metadata: row.metadata || {},
  };
}

async function getStrategyParamsMap(options = {}) {
  const refresh = options.refresh === true;
  if (!refresh && paramsCache && paramsCache.expiresAt > Date.now()) {
    return paramsCache.value;
  }

  await ensureBeaconNightlyTables();
  await seedDefaultStrategyParams();

  const result = await queryWithTimeout(
    `SELECT
       strategy_id,
       enabled,
       min_grade_score,
       min_win_rate,
       min_profit_factor,
       confidence_multiplier,
       max_picks_per_run,
       hold_days,
       evaluation_lookback,
       updated_at,
       metadata
     FROM ${PARAMS_TABLE}
     ORDER BY strategy_id ASC`,
    [],
    {
      timeoutMs: 15000,
      label: 'beacon_nightly.params.read',
      maxRetries: 0,
    }
  );

  const value = new Map((result.rows || []).map((row) => {
    const normalized = normalizeParamRow(row);
    return [normalized.strategy_id, normalized];
  }));

  paramsCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  };

  return value;
}

function clearStrategyParamsCache() {
  paramsCache = null;
}

module.exports = {
  DEFAULT_PARAM_VALUES,
  OUTCOMES_TABLE,
  PARAMS_HISTORY_TABLE,
  PARAMS_TABLE,
  RUNS_TABLE,
  buildDefaultParamRow,
  clearStrategyParamsCache,
  ensureBeaconNightlyTables,
  getStrategyParamsMap,
  normalizeParamRow,
  seedDefaultStrategyParams,
};