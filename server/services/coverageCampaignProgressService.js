const { queryWithTimeout } = require('../db/pg');

const COVERAGE_CAMPAIGN_PROGRESS_TABLE = 'coverage_campaign_progress';

async function ensureCoverageCampaignProgressTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS coverage_campaign_progress (
       id BIGSERIAL PRIMARY KEY,
       total_symbols INTEGER NOT NULL DEFAULT 0,
       processed_symbols INTEGER NOT NULL DEFAULT 0,
       has_data INTEGER NOT NULL DEFAULT 0,
       unsupported INTEGER NOT NULL DEFAULT 0,
       started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    [],
    {
      label: 'coverage_campaign_progress.ensure_table',
      timeoutMs: 15000,
      maxRetries: 0,
      poolType: 'write',
    }
  );
}

async function startCoverageCampaignProgress({ totalSymbols = 0, processedSymbols = 0, hasData = 0, unsupported = 0 } = {}) {
  await ensureCoverageCampaignProgressTable();
  const result = await queryWithTimeout(
    `INSERT INTO coverage_campaign_progress (
       total_symbols,
       processed_symbols,
       has_data,
       unsupported,
       started_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING id, total_symbols, processed_symbols, has_data, unsupported, started_at, updated_at`,
    [totalSymbols, processedSymbols, hasData, unsupported],
    {
      label: 'coverage_campaign_progress.start',
      timeoutMs: 15000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return result.rows?.[0] || null;
}

async function updateCoverageCampaignProgress(id, { processedSymbols, hasData, unsupported } = {}) {
  if (!id) {
    return null;
  }

  await ensureCoverageCampaignProgressTable();
  const result = await queryWithTimeout(
    `UPDATE coverage_campaign_progress
        SET processed_symbols = COALESCE($2, processed_symbols),
            has_data = COALESCE($3, has_data),
            unsupported = COALESCE($4, unsupported),
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, total_symbols, processed_symbols, has_data, unsupported, started_at, updated_at`,
    [id, processedSymbols, hasData, unsupported],
    {
      label: 'coverage_campaign_progress.update',
      timeoutMs: 15000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return result.rows?.[0] || null;
}

async function getLatestCoverageCampaignProgress() {
  await ensureCoverageCampaignProgressTable();
  const result = await queryWithTimeout(
    `SELECT id, total_symbols, processed_symbols, has_data, unsupported, started_at, updated_at
       FROM coverage_campaign_progress
      ORDER BY started_at DESC, id DESC
      LIMIT 1`,
    [],
    {
      label: 'coverage_campaign_progress.latest',
      timeoutMs: 10000,
      maxRetries: 0,
    }
  );

  return result.rows?.[0] || null;
}

module.exports = {
  COVERAGE_CAMPAIGN_PROGRESS_TABLE,
  ensureCoverageCampaignProgressTable,
  startCoverageCampaignProgress,
  updateCoverageCampaignProgress,
  getLatestCoverageCampaignProgress,
};