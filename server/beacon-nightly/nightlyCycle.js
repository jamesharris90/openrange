const { queryWithTimeout, runWithDbPool } = require('../db/pg');
const { runNightlyIncrementalBacktest } = require('../backtester/engine');
const { tuneStrategyParams } = require('./adaptiveTuner');
const { evaluatePendingPickOutcomes } = require('./outcomeEvaluator');
const { RUNS_TABLE, ensureBeaconNightlyTables, seedDefaultStrategyParams } = require('./paramsCache');

const LOCK_KEY = 947321;

async function acquireLock() {
  const result = await runWithDbPool('write', () => queryWithTimeout(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [LOCK_KEY],
    {
      timeoutMs: 5000,
      label: 'beacon_nightly.lock.acquire',
      maxRetries: 0,
      poolType: 'write',
    }
  ));
  return result.rows?.[0]?.locked === true;
}

async function releaseLock() {
  await runWithDbPool('write', () => queryWithTimeout(
    'SELECT pg_advisory_unlock($1)',
    [LOCK_KEY],
    {
      timeoutMs: 5000,
      label: 'beacon_nightly.lock.release',
      maxRetries: 0,
      poolType: 'write',
    }
  )).catch(() => null);
}

async function createRun(metadata) {
  const result = await runWithDbPool('write', () => queryWithTimeout(
    `INSERT INTO ${RUNS_TABLE} (run_type, status, metadata, started_at, updated_at)
     VALUES ('nightly', 'running', $1::jsonb, NOW(), NOW())
     RETURNING id, started_at`,
    [JSON.stringify(metadata || {})],
    {
      timeoutMs: 10000,
      label: 'beacon_nightly.run.create',
      maxRetries: 1,
      poolType: 'write',
    }
  ));

  return result.rows?.[0] || null;
}

async function updateRun(runId, patch = {}) {
  const metadata = patch.metadata ? JSON.stringify(patch.metadata) : null;
  await runWithDbPool('write', () => queryWithTimeout(
    `UPDATE ${RUNS_TABLE}
     SET status = COALESCE($2, status),
         completed_at = COALESCE($3, completed_at),
         evaluated_pick_count = COALESCE($4, evaluated_pick_count),
         tuned_strategy_count = COALESCE($5, tuned_strategy_count),
         generated_pick_count = COALESCE($6, generated_pick_count),
         score_rows = COALESCE($7, score_rows),
         signal_rows = COALESCE($8, signal_rows),
         error = COALESCE($9, error),
         metadata = CASE WHEN $10::jsonb IS NULL THEN metadata ELSE metadata || $10::jsonb END,
         updated_at = NOW()
     WHERE id = $1`,
    [
      runId,
      patch.status || null,
      patch.completed_at || null,
      patch.evaluated_pick_count ?? null,
      patch.tuned_strategy_count ?? null,
      patch.generated_pick_count ?? null,
      patch.score_rows ?? null,
      patch.signal_rows ?? null,
      patch.error || null,
      metadata,
    ],
    {
      timeoutMs: 10000,
      label: `beacon_nightly.run.update.${runId}`,
      maxRetries: 1,
      poolType: 'write',
    }
  ));
}

async function runBeaconNightlyCycle(options = {}) {
  await ensureBeaconNightlyTables();
  await seedDefaultStrategyParams();

  const locked = await acquireLock();
  if (!locked) {
    const error = new Error('Beacon nightly worker is already running');
    error.code = 'BEACON_NIGHTLY_ALREADY_RUNNING';
    throw error;
  }

  const run = await createRun({
    trigger: options.trigger || 'manual',
    service_role: options.serviceRole || process.env.OPENRANGE_SERVICE_ROLE || 'beacon-nightly-worker',
    options: {
      skipOutcomeEvaluation: options.skipOutcomeEvaluation === true,
      skipAdaptiveTuning: options.skipAdaptiveTuning === true,
      skipBacktest: options.skipBacktest === true,
      strategyIds: Array.isArray(options.strategyIds) ? options.strategyIds : null,
      symbols: Array.isArray(options.symbols) ? options.symbols : null,
    },
  });

  try {
    const outcomeSummary = options.skipOutcomeEvaluation === true
      ? { evaluated_pick_count: 0, wins: 0, losses: 0, flats: 0, missed: 0, no_data: 0, invalid: 0, results: [] }
      : await evaluatePendingPickOutcomes({ runId: run.id });

    const tuningSummary = options.skipAdaptiveTuning === true
      ? { tuned_strategy_count: 0, changes: [] }
      : await tuneStrategyParams({ runId: run.id });

    const backtestSummary = options.skipBacktest === true
      ? { generatedSignals: 0, scoreRows: 0, pickRows: 0 }
      : await runNightlyIncrementalBacktest({
        strategyIds: options.strategyIds,
        symbols: options.symbols,
        skipScoring: false,
        skipPickGeneration: false,
        useCheckpoint: false,
      });

    const summary = {
      run_id: run.id,
      started_at: run.started_at ? new Date(run.started_at).toISOString() : null,
      completed_at: new Date().toISOString(),
      outcome_evaluation: outcomeSummary,
      adaptive_tuning: tuningSummary,
      nightly_backtest: backtestSummary,
    };

    await updateRun(run.id, {
      status: 'completed',
      completed_at: summary.completed_at,
      evaluated_pick_count: outcomeSummary.evaluated_pick_count,
      tuned_strategy_count: tuningSummary.tuned_strategy_count,
      generated_pick_count: Number(backtestSummary.pickRows || 0),
      score_rows: Number(backtestSummary.scoreRows || 0),
      signal_rows: Number(backtestSummary.generatedSignals || 0),
      metadata: summary,
    });

    return summary;
  } catch (error) {
    await updateRun(run.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: error?.stack || error?.message || String(error),
    }).catch(() => null);
    throw error;
  } finally {
    await releaseLock();
  }
}

module.exports = {
  runBeaconNightlyCycle,
};