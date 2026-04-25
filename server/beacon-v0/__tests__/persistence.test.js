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
      limit: 500,
    });

    console.log(`Wrote ${written.length} picks under run_id=${runId}`);

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