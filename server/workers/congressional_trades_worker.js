/**
 * Phase C1 worker: Daily Congressional trades ingestion.
 *
 * Schedule: 02:00 UTC (set via Railway cron, not in code)
 * Pulls latest Senate and House filings from FMP.
 */

const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
  override: false,
});

const { runCongressionalIngestion } = require('../ingestion/fmp_congressional_ingest');
const { pool } = require('../db/pg');

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[congressional-worker] Starting at ${startedAt}`);

  try {
    const result = await runCongressionalIngestion();
    console.log(`[congressional-worker] Run complete: ${result.inserted} new, ${result.skipped} skipped, ${result.duration}s`);
  } catch (error) {
    console.error('[congressional-worker] Run failed:', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch((error) => {
      console.error('[congressional-worker] Pool close error:', error.message);
    });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[congressional-worker] Failed:', error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  main,
};