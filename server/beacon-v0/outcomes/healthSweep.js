'use strict';

const { queryWithTimeout } = require('../../db/pg');

const ALLOWED_TABLES = new Set(['beacon_v0_picks', 'premarket_picks']);
const STALE_THRESHOLDS_HOURS = { 1: 6, 2: 12, 3: 24, 4: 48 };
const STALE_TO_ERRORED_DAYS = 7;

function assertAllowedTable(tableName = 'beacon_v0_picks') {
  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(`Unsupported health sweep table: ${tableName}`);
  }
  return tableName;
}

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

async function runHealthSweep({ tableName = 'beacon_v0_picks' } = {}) {
  const resolvedTableName = assertAllowedTable(tableName);
  const startedAt = Date.now();
  const staleClauses = Object.entries(STALE_THRESHOLDS_HOURS)
    .map(([checkpoint, hours]) => missingCheckpointOverdueClause({ checkpoint, hours }))
    .join(' OR ');
  const erroredClauses = [1, 2, 3, 4]
    .map((checkpoint) => missingCheckpointErroredClause(checkpoint))
    .join(' OR ');

  const staleResult = await queryWithTimeout(
    `
      UPDATE ${resolvedTableName}
      SET outcome_status = 'stale',
          outcome_complete = false
      WHERE outcome_status IN ('pending', 'partial')
        AND (${staleClauses})
      RETURNING id
    `,
    [],
    {
      timeoutMs: 10000,
      label: `beacon_v0.outcomes.health_sweep.mark_stale.${resolvedTableName}`,
      poolType: 'write',
      maxRetries: 0,
    },
  );

  const erroredResult = await queryWithTimeout(
    `
      UPDATE ${resolvedTableName}
      SET outcome_status = 'errored',
          outcome_complete = false
      WHERE outcome_status = 'stale'
        AND (${erroredClauses})
      RETURNING id
    `,
    [],
    {
      timeoutMs: 10000,
      label: `beacon_v0.outcomes.health_sweep.mark_errored.${resolvedTableName}`,
      poolType: 'write',
      maxRetries: 0,
    },
  );

  const result = {
    tableName: resolvedTableName,
    marked_stale: staleResult.rows.length,
    marked_errored: erroredResult.rows.length,
    duration_ms: Date.now() - startedAt,
  };

  console.log(JSON.stringify({ log: 'beacon_v0_outcomes.health_sweep', table: resolvedTableName, ...result }));
  return result;
}

module.exports = {
  assertAllowedTable,
  runHealthSweep,
  STALE_THRESHOLDS_HOURS,
  STALE_TO_ERRORED_DAYS,
};