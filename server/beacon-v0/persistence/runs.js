/**
 * Beacon v0 run lifecycle.
 * Manages start/complete/fail states and prevents overlapping runs.
 */

const { queryWithTimeout } = require('../../db/pg');

async function isAnotherRunActive() {
  const result = await queryWithTimeout(
    `
      SELECT COUNT(*)::int AS active_count
      FROM beacon_v0_runs
      WHERE status = 'running'
        AND started_at > NOW() - INTERVAL '2 hours'
    `,
    [],
    {
      label: 'beacon_v0.runs.is_active',
      timeoutMs: 5000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return Number(result.rows[0]?.active_count || 0) > 0;
}

async function reapStaleRuns() {
  const result = await queryWithTimeout(
    `
      UPDATE beacon_v0_runs
      SET status = 'failed',
          completed_at = NOW(),
          error = 'Auto-reaped: run was stuck in running state beyond max duration'
      WHERE status = 'running'
        AND started_at < NOW() - INTERVAL '2 hours'
      RETURNING id, run_id, started_at
    `,
    [],
    {
      label: 'beacon_v0.runs.reap',
      timeoutMs: 5000,
      slowQueryMs: 1000,
      poolType: 'write',
      maxRetries: 1,
    },
  );

  return result.rows;
}

async function recordRunStart(runId, universeSize) {
  const result = await queryWithTimeout(
    `
      INSERT INTO beacon_v0_runs (run_id, status, universe_size)
      VALUES ($1, 'running', $2)
      RETURNING id
    `,
    [runId, universeSize],
    {
      label: 'beacon_v0.runs.start',
      timeoutMs: 5000,
      slowQueryMs: 1000,
      poolType: 'write',
      maxRetries: 1,
    },
  );

  return result.rows[0].id;
}

async function recordRunSuccess(runId, picksGenerated, durationSeconds, metadata = {}) {
  await queryWithTimeout(
    `
      UPDATE beacon_v0_runs
      SET status = 'completed',
          completed_at = NOW(),
          picks_generated = $2,
          duration_seconds = $3,
          metadata = $4::jsonb
      WHERE run_id = $1
    `,
    [runId, picksGenerated, durationSeconds, JSON.stringify(metadata)],
    {
      label: 'beacon_v0.runs.complete',
      timeoutMs: 5000,
      slowQueryMs: 1000,
      poolType: 'write',
      maxRetries: 1,
    },
  );
}

async function recordRunFailure(runId, error, durationSeconds) {
  await queryWithTimeout(
    `
      UPDATE beacon_v0_runs
      SET status = 'failed',
          completed_at = NOW(),
          duration_seconds = $2,
          error = $3
      WHERE run_id = $1
    `,
    [runId, durationSeconds, String(error).slice(0, 1000)],
    {
      label: 'beacon_v0.runs.fail',
      timeoutMs: 5000,
      slowQueryMs: 1000,
      poolType: 'write',
      maxRetries: 1,
    },
  );
}

module.exports = {
  isAnotherRunActive,
  reapStaleRuns,
  recordRunFailure,
  recordRunStart,
  recordRunSuccess,
};