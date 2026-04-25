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
const {
  isAnotherRunActive,
  reapStaleRuns,
  recordRunFailure,
  recordRunStart,
  recordRunSuccess,
} = require('../beacon-v0/persistence/runs');
const { generateRunId } = require('../beacon-v0/persistence/picks');
const { pool, queryWithTimeout } = require('../db/pg');

async function getEvaluationUniverse() {
  const result = await queryWithTimeout(
    `
      WITH universe AS (
        SELECT UPPER(symbol) AS symbol
        FROM ticker_classifications
        WHERE symbol IS NOT NULL
        UNION
        SELECT UPPER(symbol) AS symbol
        FROM opportunity_stream
        WHERE symbol IS NOT NULL
      )
      SELECT DISTINCT symbol
      FROM universe
      WHERE symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'
      ORDER BY symbol
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
  console.log('[beacon-v0-worker] Starting at', new Date().toISOString());
  const startedAt = Date.now();
  const runId = generateRunId();

  try {
    const staleRuns = await reapStaleRuns();
    if (staleRuns.length > 0) {
      console.log(
        `[beacon-v0-worker] Reaped ${staleRuns.length} stale run(s):`,
        staleRuns.map((run) => run.run_id).join(', '),
      );
    }

    if (await isAnotherRunActive()) {
      console.log('[beacon-v0-worker] Another run is active, skipping this trigger');
      return;
    }

    const symbols = await getEvaluationUniverse();
    console.log(`[beacon-v0-worker] Universe: ${symbols.length} symbols`);

    if (symbols.length === 0) {
      console.log('[beacon-v0-worker] Empty universe, exiting');
      return;
    }

    await recordRunStart(runId, symbols.length);

    const { picks } = await runBeaconPipeline(symbols, {
      persist: true,
      runId,
      limit: 20,
    });
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);

    await recordRunSuccess(runId, picks.length, durationSeconds, {
      signals_processed: 5,
      worker_version: 'v0.2-phase43',
    });

    console.log(`[beacon-v0-worker] Run ${runId}: ${picks.length} picks written in ${durationSeconds}s`);
  } catch (error) {
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    console.error('[beacon-v0-worker] Failed:', error.stack || error.message);

    try {
      await recordRunFailure(runId, error.message || String(error), durationSeconds);
    } catch (recordError) {
      console.error('[beacon-v0-worker] Failed to record failure:', recordError.stack || recordError.message);
    }

    throw error;
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