const { queryWithTimeout } = require('../db/pg');

const COVERAGE_STATUS_TABLE = 'data_coverage_status';
const VALID_STATUSES = [
  'HAS_DATA',
  'PARTIAL_NEWS',
  'PARTIAL_EARNINGS',
  'NO_NEWS',
  'NO_EARNINGS',
  'STRUCTURALLY_UNSUPPORTED',
  'LOW_QUALITY_TICKER',
  'INACTIVE',
];
let coverageStatusTableReady = false;
let coverageStatusTablePromise = null;

function normalizeCoverageStatus(value) {
  const status = String(value || '').trim().toUpperCase();

  if (status === 'MISSING') {
    return 'NO_EARNINGS';
  }

  if (status === 'UNSUPPORTED') {
    return 'STRUCTURALLY_UNSUPPORTED';
  }

  return status;
}

async function ensureCoverageStatusTable() {
  if (coverageStatusTableReady) {
    return true;
  }

  if (coverageStatusTablePromise) {
    return coverageStatusTablePromise;
  }

  coverageStatusTablePromise = (async () => {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS data_coverage_status (
       symbol TEXT PRIMARY KEY,
       status TEXT NOT NULL CHECK (status IN ('HAS_DATA', 'PARTIAL_NEWS', 'PARTIAL_EARNINGS', 'NO_NEWS', 'NO_EARNINGS', 'STRUCTURALLY_UNSUPPORTED', 'LOW_QUALITY_TICKER', 'INACTIVE')),
       last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    [],
    {
      label: 'coverage_status.ensure_table',
      timeoutMs: 15000,
      maxRetries: 0,
    }
  );

  await queryWithTimeout(
    `ALTER TABLE data_coverage_status
      ADD COLUMN IF NOT EXISTS status TEXT`,
    [],
    {
      label: 'coverage_status.ensure_status_column',
      timeoutMs: 15000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await queryWithTimeout(
    `ALTER TABLE data_coverage_status
      DROP CONSTRAINT IF EXISTS data_coverage_status_status_check`,
    [],
    {
      label: 'coverage_status.drop_status_check',
      timeoutMs: 15000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await migrateLegacyStatuses();

  await queryWithTimeout(
    `ALTER TABLE data_coverage_status
      ADD CONSTRAINT data_coverage_status_status_check
      CHECK (status IS NULL OR status IN ('HAS_DATA', 'PARTIAL_NEWS', 'PARTIAL_EARNINGS', 'NO_NEWS', 'NO_EARNINGS', 'STRUCTURALLY_UNSUPPORTED', 'LOW_QUALITY_TICKER', 'INACTIVE'))`,
    [],
    {
      label: 'coverage_status.add_status_check',
      timeoutMs: 15000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await queryWithTimeout(
    `ALTER TABLE data_coverage_status
      ADD COLUMN IF NOT EXISTS last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    [],
    {
      label: 'coverage_status.ensure_last_checked',
      timeoutMs: 15000,
      maxRetries: 0,
    }
  );

  await cleanupLegacyNullStatuses();

    coverageStatusTableReady = true;
    return true;
  })().catch((error) => {
    coverageStatusTablePromise = null;
    throw error;
  });

  return coverageStatusTablePromise;
}

async function cleanupLegacyNullStatuses() {
  const result = await queryWithTimeout(
    `UPDATE data_coverage_status
        SET status = 'INACTIVE',
            last_checked = NOW()
      WHERE status IS NULL`,
    [],
    {
      label: 'coverage_status.cleanup_legacy_nulls',
      timeoutMs: 15000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return Number(result.rowCount || 0);
}

async function migrateLegacyStatuses() {
  const result = await queryWithTimeout(
    `UPDATE data_coverage_status
        SET status = CASE
          WHEN status = 'MISSING' THEN 'NO_EARNINGS'
          WHEN status = 'UNSUPPORTED' THEN 'STRUCTURALLY_UNSUPPORTED'
          ELSE status
        END,
            last_checked = NOW()
      WHERE status IN ('MISSING', 'UNSUPPORTED')`,
    [],
    {
      label: 'coverage_status.migrate_legacy_statuses',
      timeoutMs: 15000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return Number(result.rowCount || 0);
}

async function upsertCoverageStatuses(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { inserted: 0, batches: 0 };
  }

  await ensureCoverageStatusTable();

  const preparedRows = rows
    .map((row) => ({
      symbol: String(row.symbol || '').trim().toUpperCase(),
      status: normalizeCoverageStatus(row.status),
      last_checked: row.last_checked || new Date().toISOString(),
    }))
    .filter((row) => row.symbol && VALID_STATUSES.includes(row.status));

  if (preparedRows.length === 0) {
    return { inserted: 0, batches: 0 };
  }

  const batchSize = 500;
  let inserted = 0;
  let batches = 0;

  for (let index = 0; index < preparedRows.length; index += batchSize) {
    const chunk = preparedRows.slice(index, index + batchSize);
    const values = [];
    const placeholders = chunk.map((row, rowIndex) => {
      const base = rowIndex * 3;
      values.push(row.symbol, row.status, row.last_checked);
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    });

    await queryWithTimeout(
      `INSERT INTO data_coverage_status (symbol, status, last_checked)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (symbol)
       DO UPDATE SET
         status = EXCLUDED.status,
         last_checked = EXCLUDED.last_checked`,
      values,
      {
        label: 'coverage_status.upsert',
        timeoutMs: 30000,
        maxRetries: 0,
        poolType: 'write',
      }
    );

    inserted += chunk.length;
    batches += 1;
  }

  return { inserted, batches };
}

async function getCoverageStatusCounts() {
  await ensureCoverageStatusTable();
  const result = await queryWithTimeout(
    `SELECT status, COUNT(*)::int AS count
       FROM data_coverage_status
      GROUP BY status`,
    [],
    {
      label: 'coverage_status.counts',
      timeoutMs: 10000,
      maxRetries: 0,
    }
  );

  const counts = {
    HAS_DATA: 0,
    PARTIAL_NEWS: 0,
    PARTIAL_EARNINGS: 0,
    NO_NEWS: 0,
    NO_EARNINGS: 0,
    STRUCTURALLY_UNSUPPORTED: 0,
    LOW_QUALITY_TICKER: 0,
    INACTIVE: 0,
  };

  for (const row of result.rows || []) {
    const status = String(row.status || '').toUpperCase();
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] = Number(row.count || 0);
    }
  }

  return counts;
}

async function getCoverageStatusBreakdown() {
  await ensureCoverageStatusTable();
  const result = await queryWithTimeout(
    `SELECT status, COUNT(*)::int AS count
       FROM data_coverage_status
      GROUP BY status
      ORDER BY status`,
    [],
    {
      label: 'coverage_status.breakdown',
      timeoutMs: 10000,
      maxRetries: 0,
    }
  );

  return result.rows || [];
}

async function getCoverageStatusesBySymbols(symbols) {
  await ensureCoverageStatusTable();

  const normalizedSymbols = (symbols || [])
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter(Boolean);

  if (normalizedSymbols.length === 0) {
    return new Map();
  }

  const result = await queryWithTimeout(
    `SELECT symbol, status, last_checked
       FROM data_coverage_status
      WHERE symbol = ANY($1::text[])`,
    [normalizedSymbols],
    {
      label: 'coverage_status.by_symbols',
      timeoutMs: 15000,
      maxRetries: 0,
    }
  );

  return new Map((result.rows || []).map((row) => [String(row.symbol || '').trim().toUpperCase(), row]));
}

module.exports = {
  COVERAGE_STATUS_TABLE,
  VALID_STATUSES,
  normalizeCoverageStatus,
  ensureCoverageStatusTable,
  cleanupLegacyNullStatuses,
  migrateLegacyStatuses,
  upsertCoverageStatuses,
  getCoverageStatusCounts,
  getCoverageStatusBreakdown,
  getCoverageStatusesBySymbols,
};