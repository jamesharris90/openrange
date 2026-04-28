'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { checkRecentRun } = require('./lib/recencyGuard');
const { runWindow } = require('../beacon-v0/windows/runner');
const { pool } = require('../db/pg');

const RECENCY_WINDOW_HOURS = Number(process.env.BEACON_V0_PREMARKET_RECENCY_WINDOW_HOURS || 20);

async function main() {
  console.log(JSON.stringify({
    log: 'beacon_v0_premarket_worker.start',
    timestamp: new Date().toISOString(),
    recency_window_hours: RECENCY_WINDOW_HOURS,
  }));

  const skip = await checkRecentRun({
    table: 'beacon_v0_runs',
    recencyWindowHours: RECENCY_WINDOW_HOURS,
    workerName: 'beacon-v0-premarket-worker',
    additionalWhere: `metadata->>'window' = 'premarket'`,
  });

  if (skip) {
    console.log(JSON.stringify({
      log: 'beacon_v0_premarket_worker.skip',
      ...skip,
    }));
    return { skipped: true, reason: skip.reason, runId: skip.recent_run_id };
  }

  const result = await runWindow('premarket');
  console.log(JSON.stringify({
    log: 'beacon_v0_premarket_worker.completed',
    ...result,
  }));
  return result;
}

if (require.main === module) {
  main()
    .then(() => pool.end().catch(() => {}))
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(JSON.stringify({
        log: 'beacon_v0_premarket_worker.failed',
        error: error.message,
        stack: error.stack,
      }));
      pool.end().finally(() => process.exit(1));
    });
}

module.exports = { main };
