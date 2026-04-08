const { queryWithTimeout, runWithDbPool } = require('../db/pg');

const COVERAGE_CAMPAIGN_STATE_TABLE = 'coverage_campaign_state';
const DEFAULT_STATE_KEYS = ['status', 'checkpoint', 'hourly'];

let ensureTablePromise = null;

async function ensureCoverageCampaignStateTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = runWithDbPool('write', () => queryWithTimeout(
      `CREATE TABLE IF NOT EXISTS ${COVERAGE_CAMPAIGN_STATE_TABLE} (
         state_key TEXT PRIMARY KEY,
         payload JSONB NOT NULL DEFAULT '{}'::jsonb,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      [],
      {
        timeoutMs: 20000,
        label: 'coverage_campaign_state.ensure_table',
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

async function writeCoverageCampaignState(stateKey, payload) {
  await ensureCoverageCampaignStateTable();
  return runWithDbPool('write', () => queryWithTimeout(
    `INSERT INTO ${COVERAGE_CAMPAIGN_STATE_TABLE} (state_key, payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (state_key)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [stateKey, JSON.stringify(payload ?? null)],
    {
      timeoutMs: 10000,
      label: `coverage_campaign_state.write.${stateKey}`,
      maxRetries: 1,
      poolType: 'write',
    }
  ));
}

async function readCoverageCampaignState(stateKeys = DEFAULT_STATE_KEYS) {
  await ensureCoverageCampaignStateTable();
  const result = await queryWithTimeout(
    `SELECT state_key, payload, updated_at
     FROM ${COVERAGE_CAMPAIGN_STATE_TABLE}
     WHERE state_key = ANY($1::text[])`,
    [stateKeys],
    {
      timeoutMs: 10000,
      label: 'coverage_campaign_state.read',
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

async function appendCoverageCampaignHourlyEntry(entry, maxEntries = 500) {
  const existing = await readCoverageCampaignState(['hourly']).catch(() => ({}));
  const current = Array.isArray(existing.hourly?.payload) ? existing.hourly.payload : [];
  const nextPayload = current.concat([entry]).slice(-maxEntries);
  await writeCoverageCampaignState('hourly', nextPayload);
  return nextPayload;
}

async function deleteCoverageCampaignState(stateKeys = DEFAULT_STATE_KEYS) {
  await ensureCoverageCampaignStateTable();
  return runWithDbPool('write', () => queryWithTimeout(
    `DELETE FROM ${COVERAGE_CAMPAIGN_STATE_TABLE}
     WHERE state_key = ANY($1::text[])`,
    [stateKeys],
    {
      timeoutMs: 10000,
      label: 'coverage_campaign_state.delete',
      maxRetries: 1,
      poolType: 'write',
    }
  ));
}

module.exports = {
  COVERAGE_CAMPAIGN_STATE_TABLE,
  ensureCoverageCampaignStateTable,
  writeCoverageCampaignState,
  readCoverageCampaignState,
  appendCoverageCampaignHourlyEntry,
  deleteCoverageCampaignState,
};