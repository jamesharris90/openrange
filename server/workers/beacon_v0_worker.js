/**
 * Beacon v0 nightly worker.
 * Runs the v0 orchestrator and writes picks to beacon_v0_picks.
 *
 * Independent of beacon-nightly-worker, which continues to run separately.
 */

const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
  override: false,
});

const { runBeaconPipeline } = require('../beacon-v0/orchestrator/run');
const { pool, queryWithTimeout } = require('../db/pg');

async function getEvaluationUniverse() {
  const result = await queryWithTimeout(
    `
      SELECT DISTINCT UPPER(symbol) AS symbol
      FROM earnings_events
      WHERE symbol IS NOT NULL
        AND COALESCE(earnings_date, report_date) >= CURRENT_DATE
        AND COALESCE(earnings_date, report_date) <= CURRENT_DATE + interval '7 days'
      ORDER BY UPPER(symbol)
    `,
    [],
    {
      label: 'beacon_v0.worker.universe',
      timeoutMs: 10000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return result.rows.map((row) => row.symbol).filter(Boolean);
}

async function main() {
  const startedAt = Date.now();
  console.log('[beacon-v0-worker] Starting run at', new Date().toISOString());

  try {
    const symbols = await getEvaluationUniverse();
    console.log(`[beacon-v0-worker] Universe: ${symbols.length} symbols`);

    if (symbols.length === 0) {
      console.log('[beacon-v0-worker] Empty universe, exiting');
      return;
    }

    const { picks, runId } = await runBeaconPipeline(symbols, {
      persist: true,
      limit: 5000,
    });

    console.log(`[beacon-v0-worker] Run ${runId}: ${picks.length} picks written`);
    console.log(`[beacon-v0-worker] Duration: ${Math.round((Date.now() - startedAt) / 1000)}s`);
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[beacon-v0-worker] Failed:', error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  getEvaluationUniverse,
  main,
};