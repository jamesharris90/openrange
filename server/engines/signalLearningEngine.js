const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const COMPONENTS = [
  'gap_percent',
  'rvol',
  'float_rotation',
  'liquidity_surge',
  'catalyst_score',
  'sector_score',
  'confirmation_score',
];

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function ensureLearningTables() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS signal_component_outcomes (
      id BIGSERIAL PRIMARY KEY,
      snapshot_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      symbol TEXT,
      move_percent NUMERIC,
      gap_percent NUMERIC,
      rvol NUMERIC,
      float_rotation NUMERIC,
      liquidity_surge NUMERIC,
      catalyst_score NUMERIC,
      sector_score NUMERIC,
      confirmation_score NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 8000, label: 'learning_engine.ensure_component_outcomes', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS signal_weight_calibration (
      component TEXT PRIMARY KEY,
      weight NUMERIC NOT NULL,
      success_rate NUMERIC NOT NULL,
      avg_move NUMERIC NOT NULL,
      signals_analyzed INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 8000, label: 'learning_engine.ensure_weight_calibration', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_signal_component_outcomes_snapshot_date
     ON signal_component_outcomes (snapshot_date DESC)`,
    [],
    { timeoutMs: 8000, label: 'learning_engine.ensure_component_outcomes_idx', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE signal_weight_calibration ADD COLUMN IF NOT EXISTS component TEXT',
    [],
    { timeoutMs: 8000, label: 'learning_engine.ensure_calibration_component', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE signal_weight_calibration ADD COLUMN IF NOT EXISTS weight NUMERIC',
    [],
    { timeoutMs: 8000, label: 'learning_engine.ensure_calibration_weight', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE signal_weight_calibration ADD COLUMN IF NOT EXISTS success_rate NUMERIC NOT NULL DEFAULT 0',
    [],
    { timeoutMs: 8000, label: 'learning_engine.ensure_calibration_success_rate', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE signal_weight_calibration ADD COLUMN IF NOT EXISTS avg_move NUMERIC NOT NULL DEFAULT 0',
    [],
    { timeoutMs: 8000, label: 'learning_engine.ensure_calibration_avg_move', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE signal_weight_calibration ADD COLUMN IF NOT EXISTS signals_analyzed INTEGER NOT NULL DEFAULT 0',
    [],
    { timeoutMs: 8000, label: 'learning_engine.ensure_calibration_signals_analyzed', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE signal_weight_calibration ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    [],
    { timeoutMs: 8000, label: 'learning_engine.ensure_calibration_updated_at', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE signal_weight_calibration ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    [],
    { timeoutMs: 8000, label: 'learning_engine.ensure_calibration_created_at', maxRetries: 0 }
  );

  await queryWithTimeout(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_weight_calibration_component ON signal_weight_calibration(component)',
    [],
    { timeoutMs: 8000, label: 'learning_engine.ensure_calibration_component_idx', maxRetries: 0 }
  );
}

function buildStatsByComponent(rows = []) {
  const stats = Object.fromEntries(COMPONENTS.map((component) => [component, {
    component,
    samples: 0,
    successCount: 0,
    moveSum: 0,
    successRate: 0,
    avgMove: 0,
    rawWeight: 0,
  }]));

  for (const row of rows) {
    const movePercent = toNumber(row.move_percent);
    const isSuccess = movePercent >= 4;

    for (const component of COMPONENTS) {
      const componentValue = Number(row[component]);
      if (!Number.isFinite(componentValue)) {
        continue;
      }

      const stat = stats[component];
      stat.samples += 1;
      stat.moveSum += movePercent;
      if (isSuccess) {
        stat.successCount += 1;
      }
    }
  }

  for (const component of COMPONENTS) {
    const stat = stats[component];
    if (!stat.samples) {
      continue;
    }

    stat.successRate = stat.successCount / stat.samples;
    stat.avgMove = stat.moveSum / stat.samples;
    stat.rawWeight = stat.successRate * stat.avgMove;
  }

  return stats;
}

function normalizeWeights(statsByComponent) {
  const rawWeights = COMPONENTS
    .map((component) => statsByComponent[component].rawWeight)
    .filter((value) => Number.isFinite(value));

  const minRaw = rawWeights.length ? Math.min(...rawWeights) : 0;
  const maxRaw = rawWeights.length ? Math.max(...rawWeights) : 0;
  const span = maxRaw - minRaw;

  const normalized = {};
  for (const component of COMPONENTS) {
    const stat = statsByComponent[component];

    if (!stat.samples) {
      normalized[component] = 1;
      continue;
    }

    if (span <= 0) {
      normalized[component] = 1;
      continue;
    }

    const scaled = 0.5 + ((stat.rawWeight - minRaw) / span) * 1.5;
    normalized[component] = clamp(scaled, 0.5, 2.0);
  }

  return normalized;
}

async function upsertCalibrationRows(statsByComponent, normalizedWeights) {
  const components = [];
  const weights = [];
  const successRates = [];
  const avgMoves = [];
  const signalsAnalyzed = [];

  for (const component of COMPONENTS) {
    const stat = statsByComponent[component];
    components.push(component);
    weights.push(Number(toNumber(normalizedWeights[component], 1).toFixed(6)));
    successRates.push(Number(toNumber(stat.successRate).toFixed(6)));
    avgMoves.push(Number(toNumber(stat.avgMove).toFixed(6)));
    signalsAnalyzed.push(stat.samples);
  }

  await queryWithTimeout(
    `INSERT INTO signal_weight_calibration (
       component,
       weight,
       success_rate,
       avg_move,
       signals_analyzed,
       updated_at
     )
     SELECT
       unnest($1::text[]) AS component,
       unnest($2::numeric[]) AS weight,
       unnest($3::numeric[]) AS success_rate,
       unnest($4::numeric[]) AS avg_move,
       unnest($5::int[]) AS signals_analyzed,
       NOW() AS updated_at
     ON CONFLICT (component)
     DO UPDATE SET
       weight = EXCLUDED.weight,
       success_rate = EXCLUDED.success_rate,
       avg_move = EXCLUDED.avg_move,
       signals_analyzed = EXCLUDED.signals_analyzed,
       updated_at = NOW()`,
    [components, weights, successRates, avgMoves, signalsAnalyzed],
    { timeoutMs: 10000, label: 'learning_engine.upsert_calibration_rows', maxRetries: 0 }
  );
}

async function runSignalLearningEngine() {
  try {
    await ensureLearningTables();

    const { rows } = await queryWithTimeout(
    `SELECT *
     FROM signal_component_outcomes
     WHERE snapshot_date >= NOW() - INTERVAL '30 days'`,
    [],
    { timeoutMs: 10000, label: 'learning_engine.select_recent_outcomes', maxRetries: 0 }
  );

    const statsByComponent = buildStatsByComponent(rows);
    const normalizedWeights = normalizeWeights(statsByComponent);
    await upsertCalibrationRows(statsByComponent, normalizedWeights);

    const totalSignals = rows.length;
    const successCount = rows.filter((row) => toNumber(row.move_percent) >= 4).length;
    const successRate = totalSignals ? successCount / totalSignals : 0;

    logger.info('[LEARNING_ENGINE] signals analysed', { signals_analysed: totalSignals });
    logger.info('[LEARNING_ENGINE] success rate', {
      success_rate: Number(successRate.toFixed(6)),
      success_count: successCount,
      failures: Math.max(totalSignals - successCount, 0),
    });
    logger.info('[LEARNING_ENGINE] new weights', {
      weights: Object.fromEntries(
        COMPONENTS.map((component) => [component, Number(toNumber(normalizedWeights[component], 1).toFixed(6))])
      ),
    });

    return {
      signalsAnalysed: totalSignals,
      successRate: Number(successRate.toFixed(6)),
      weights: normalizedWeights,
    };
  } catch (error) {
    logger.error('[LEARNING_ENGINE] run failed', { error: error.message });
    return {
      signalsAnalysed: 0,
      successRate: 0,
      weights: {},
      error: error.message,
    };
  }
}

module.exports = {
  COMPONENTS,
  runSignalLearningEngine,
  ensureLearningTables,
};
