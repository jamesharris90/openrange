'use strict';

const { queryWithTimeout } = require('../../db/pg');

const STALE_THRESHOLDS_HOURS = { 1: 6, 2: 12, 3: 24, 4: 48 };
const STALE_TO_ERRORED_DAYS = 7;

function missingCheckpointOverdueClause({ checkpoint, hours }) {
  return `(
    outcome_t${checkpoint}_due_at IS NOT NULL
    AND outcome_t${checkpoint}_captured_at IS NULL
    AND outcome_t${checkpoint}_due_at < NOW() - INTERVAL '${hours} hours'
  )`;
}

function missingCheckpointErroredClause(checkpoint) {
  return `(
    outcome_t${checkpoint}_due_at IS NOT NULL
    AND outcome_t${checkpoint}_captured_at IS NULL
    AND outcome_t${checkpoint}_due_at < NOW() - INTERVAL '${STALE_TO_ERRORED_DAYS} days'
  )`;
}

async function runHealthSweep() {
  const startedAt = Date.now();
  const staleClauses = Object.entries(STALE_THRESHOLDS_HOURS)
    .map(([checkpoint, hours]) => missingCheckpointOverdueClause({ checkpoint, hours }))
    .join(' OR ');
  const erroredClauses = [1, 2, 3, 4]
    .map((checkpoint) => missingCheckpointErroredClause(checkpoint))
    .join(' OR ');

  const staleResult = await queryWithTimeout(
    `
      UPDATE beacon_v0_picks
      SET outcome_status = 'stale',
          outcome_complete = false
      WHERE outcome_status IN ('pending', 'partial')
        AND (${staleClauses})
      RETURNING id
    `,
    [],
    {
      timeoutMs: 10000,
      label: 'beacon_v0.outcomes.health_sweep.mark_stale',
      poolType: 'write',
      maxRetries: 0,
    },
  );

  const erroredResult = await queryWithTimeout(
    `
      UPDATE beacon_v0_picks
      SET outcome_status = 'errored',
          outcome_complete = false
      WHERE outcome_status = 'stale'
        AND (${erroredClauses})
      RETURNING id
    `,
    [],
    {
      timeoutMs: 10000,
      label: 'beacon_v0.outcomes.health_sweep.mark_errored',
      poolType: 'write',
      maxRetries: 0,
    },
  );

  const result = {
    marked_stale: staleResult.rows.length,
    marked_errored: erroredResult.rows.length,
    duration_ms: Date.now() - startedAt,
  };

  console.log(JSON.stringify({ log: 'beacon_v0_outcomes.health_sweep', ...result }));
  return result;
}

module.exports = {
  runHealthSweep,
  STALE_THRESHOLDS_HOURS,
  STALE_TO_ERRORED_DAYS,
};