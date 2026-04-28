'use strict';

const { queryWithTimeout } = require('../../db/pg');

const ALLOWED_TABLES = new Set(['beacon_v0_runs', 'beacon_nightly_runs']);
const ALLOWED_RUN_ID_COLUMNS = new Set(['run_id', 'id']);

/**
 * Check if a recent successful/running run exists for the given worker.
 * Returns null if execution should proceed, or a skip reason object.
 *
 * Fails open: any error returns null (proceed with execution).
 */
async function checkRecentRun({ table, recencyWindowHours, workerName, runIdColumn = 'run_id' }) {
  if (process.env.FORCE_RUN === '1') {
    return null;
  }

  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Unsupported recency guard table: ${table}`);
  }
  if (!ALLOWED_RUN_ID_COLUMNS.has(runIdColumn)) {
    throw new Error(`Unsupported recency guard run id column: ${runIdColumn}`);
  }

  try {
    const { rows } = await queryWithTimeout(
      `SELECT
         ${runIdColumn}::text AS run_id,
         started_at,
         completed_at,
         status,
         EXTRACT(EPOCH FROM (NOW() - started_at)) / 3600.0 AS hours_since_start
       FROM ${table}
       WHERE status IN ('completed', 'running')
         AND started_at > NOW() - ($1 || ' hours')::interval
       ORDER BY started_at DESC
       LIMIT 1`,
      [String(recencyWindowHours)],
      {
        timeoutMs: 5000,
        label: `recency_guard.${workerName}`,
        maxRetries: 0,
        poolType: 'read',
      },
    );

    if (rows.length === 0) {
      return null;
    }

    const recent = rows[0];
    return {
      skip: true,
      reason: 'recent_run_exists',
      worker: workerName,
      recent_run_id: recent.run_id,
      recent_started_at: recent.started_at,
      recent_status: recent.status,
      hours_since_start: Number.parseFloat(recent.hours_since_start).toFixed(2),
      window_hours: recencyWindowHours,
    };
  } catch (error) {
    console.warn(JSON.stringify({
      log: 'recency_guard.fail_open',
      worker: workerName,
      error: error.message,
      action: 'proceeding_with_execution',
    }));
    return null;
  }
}

module.exports = { checkRecentRun };
