const { queryWithTimeout, runWithDbPool } = require('../db/pg');

const PHASE2_BACKFILL_STATE_TABLE = 'phase2_backfill_state';
const DEFAULT_STATE_KEYS = ['status', 'checkpoint', 'events'];

let ensureTablePromise = null;

async function ensurePhase2BackfillStateTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = runWithDbPool('write', () => queryWithTimeout(
      `CREATE TABLE IF NOT EXISTS ${PHASE2_BACKFILL_STATE_TABLE} (
         state_key TEXT PRIMARY KEY,
         payload JSONB NOT NULL DEFAULT '{}'::jsonb,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      [],
      {
        timeoutMs: 20000,
        label: 'phase2_backfill_state.ensure_table',
        maxRetries: 1,
        poolType: 'write',
      }
    )).catch((error) => {
      ensureTablePromise = null;
      throw error;
    });
  }

  return ensureTablePromise;
}

async function writePhase2BackfillState(stateKey, payload) {
  await ensurePhase2BackfillStateTable();
  return runWithDbPool('write', () => queryWithTimeout(
    `INSERT INTO ${PHASE2_BACKFILL_STATE_TABLE} (state_key, payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (state_key)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [stateKey, JSON.stringify(payload ?? null)],
    {
      timeoutMs: 10000,
      label: `phase2_backfill_state.write.${stateKey}`,
      maxRetries: 1,
      poolType: 'write',
    }
  ));
}

async function readPhase2BackfillState(stateKeys = DEFAULT_STATE_KEYS) {
  await ensurePhase2BackfillStateTable();
  const result = await queryWithTimeout(
    `SELECT state_key, payload, updated_at
     FROM ${PHASE2_BACKFILL_STATE_TABLE}
     WHERE state_key = ANY($1::text[])`,
    [stateKeys],
    {
      timeoutMs: 10000,
      label: 'phase2_backfill_state.read',
      maxRetries: 1,
    }
  );

  return (result.rows || []).reduce((accumulator, row) => {
    accumulator[String(row.state_key)] = {
      payload: row.payload ?? null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    };
    return accumulator;
  }, {});
}

async function appendPhase2BackfillEvent(entry, maxEntries = 200) {
  const existing = await readPhase2BackfillState(['events']).catch(() => ({}));
  const current = Array.isArray(existing.events?.payload) ? existing.events.payload : [];
  const nextPayload = current.concat([entry]).slice(-maxEntries);
  await writePhase2BackfillState('events', nextPayload);
  return nextPayload;
}

async function deletePhase2BackfillState(stateKeys = DEFAULT_STATE_KEYS) {
  await ensurePhase2BackfillStateTable();
  return runWithDbPool('write', () => queryWithTimeout(
    `DELETE FROM ${PHASE2_BACKFILL_STATE_TABLE}
     WHERE state_key = ANY($1::text[])`,
    [stateKeys],
    {
      timeoutMs: 10000,
      label: 'phase2_backfill_state.delete',
      maxRetries: 1,
      poolType: 'write',
    }
  ));
}

module.exports = {
  PHASE2_BACKFILL_STATE_TABLE,
  ensurePhase2BackfillStateTable,
  writePhase2BackfillState,
  readPhase2BackfillState,
  appendPhase2BackfillEvent,
  deletePhase2BackfillState,
};