const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const { queryWithTimeout } = require('../db/pg');
const { ensureCoverageStatusTable } = require('../services/dataCoverageStatusService');
const { runPricesIngestion } = require('../ingestion/fmp_prices_ingest');

async function loadBackfillSymbols() {
  await ensureCoverageStatusTable();
  const result = await queryWithTimeout(
    `SELECT symbol
       FROM data_coverage_status
      WHERE status <> 'HAS_DATA'
        AND status <> 'STRUCTURALLY_UNSUPPORTED'
        AND status <> 'LOW_QUALITY_TICKER'
      ORDER BY CASE
        WHEN status IN ('NO_EARNINGS', 'NO_NEWS') THEN 0
        WHEN status IN ('PARTIAL_EARNINGS', 'PARTIAL_NEWS') THEN 1
        ELSE 2
      END, symbol ASC`,
    [],
    {
      label: 'coverage_backfill.load_symbols',
      timeoutMs: 15000,
      maxRetries: 0,
    }
  );

  return (result.rows || [])
    .map((row) => String(row.symbol || '').trim().toUpperCase())
    .filter(Boolean);
}

async function main() {
  const symbols = await loadBackfillSymbols();
  if (symbols.length === 0) {
    console.log('[COVERAGE_BACKFILL] no eligible symbols to process');
    return;
  }

  console.log('[COVERAGE_BACKFILL] starting', { symbols: symbols.length });
  const result = await runPricesIngestion(symbols, { fullHistory: false });
  console.log('[COVERAGE_BACKFILL] complete', JSON.stringify(result));
}

main().catch((error) => {
  console.error('[COVERAGE_BACKFILL] fatal', error.stack || error.message);
  process.exit(1);
});