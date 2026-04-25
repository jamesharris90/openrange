const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
  override: false,
});

const { runBeaconPipeline } = require('../orchestrator/run');
const { getLatestPicks } = require('../persistence/picks');
const { pool } = require('../../db/pg');

(async () => {
  try {
    console.log('Running Beacon v0 pipeline WITH persistence');
    const { picks: written, runId } = await runBeaconPipeline([], {
      persist: true,
      limit: 20,
    });

    console.log(`Wrote ${written.length} picks under run_id=${runId}`);

    if (written.length === 0) {
      throw new Error('Expected at least one Phase 43 aligned pick to be written');
    }

    if (written.length > 20) {
      throw new Error(`Expected at most 20 picks, wrote ${written.length}`);
    }

    const patternLabels = new Set(written.map((pick) => pick.pattern));
    for (const pick of written) {
      if (!pick.pattern) {
        throw new Error(`Missing pick pattern for ${pick.symbol}`);
      }
      if (!Array.isArray(pick.signals_aligned) || pick.signals_aligned.length < 2) {
        throw new Error(`Expected at least two aligned signals for ${pick.symbol}`);
      }
      if ((pick.metadata?.alignment?.alignmentCount || 0) < 2) {
        throw new Error(`Expected alignment metadata for ${pick.symbol}`);
      }
    }

    if (![...patternLabels].some((label) => label !== 'Multi-Signal Alignment')) {
      throw new Error('Expected at least one derived non-fallback pattern label');
    }

    const read = await getLatestPicks(100);
    console.log(`Read ${read.length} picks back from DB`);

    if (read.length !== written.length) {
      throw new Error(`Mismatch: wrote ${written.length}, read ${read.length}`);
    }

    console.log(JSON.stringify({
      status: 'PASS',
      runId,
      written: written.length,
      read: read.length,
      firstPick: read[0] || null,
    }, null, 2));
  } finally {
    await pool.end().catch(() => {});
  }
})().catch((error) => {
  console.error('PERSISTENCE TEST FAILED:', error.stack || error.message);
  process.exit(1);
});