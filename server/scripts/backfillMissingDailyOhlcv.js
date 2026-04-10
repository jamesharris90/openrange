const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { queryWithTimeout } = require('../db/pg');
const { runPricesIngestion } = require('../ingestion/fmp_prices_ingest');

async function query(sql, params, label, timeoutMs = 30000) {
  const result = await queryWithTimeout(sql, params, { timeoutMs, label, maxRetries: 0 });
  return result.rows;
}

async function loadMissingSymbols() {
  const rows = await query(
    `SELECT tu.symbol
     FROM ticker_universe tu
     LEFT JOIN (SELECT DISTINCT symbol FROM daily_ohlcv) d ON tu.symbol = d.symbol
     WHERE d.symbol IS NULL
     ORDER BY tu.symbol`,
    [],
    'backfill_missing_daily_ohlcv.load_missing',
  );

  return rows.map((row) => row.symbol);
}

async function countRemainingMissing() {
  const rows = await query(
    `SELECT COUNT(*)::int AS remaining
     FROM ticker_universe tu
     LEFT JOIN (SELECT DISTINCT symbol FROM daily_ohlcv) d ON tu.symbol = d.symbol
     WHERE d.symbol IS NULL`,
    [],
    'backfill_missing_daily_ohlcv.count_remaining',
  );

  return Number(rows[0]?.remaining || 0);
}

async function main() {
  const missingSymbols = await loadMissingSymbols();
  if (missingSymbols.length === 0) {
    console.log(JSON.stringify({ missingCount: 0, backfill: 'skipped', remainingMissing: 0 }, null, 2));
    return;
  }

  const result = await runPricesIngestion(missingSymbols, { fullHistory: true });
  const remainingMissing = await countRemainingMissing();

  console.log(JSON.stringify({
    missingCount: missingSymbols.length,
    attemptedSymbols: missingSymbols.length,
    insertedByTable: result.insertedByTable,
    failureCount: result.failures.length,
    noDataCount: result.noDataSymbols.length,
    noDataSample: result.noDataSymbols.slice(0, 20),
    failureSample: result.failures.slice(0, 20),
    endpointUsage: result.endpointUsage,
    fromDate: result.fromDate,
    remainingMissing,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});