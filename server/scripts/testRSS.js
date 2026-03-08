const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const worker = require('../workers/rss_worker');

async function run() {
  console.log('[TEST] Running RSS ingestion');

  if (typeof worker.ingestRSS === 'function') {
    await worker.ingestRSS();
  } else if (typeof worker.runRssWorker === 'function') {
    await worker.runRssWorker();
  } else {
    throw new Error('No RSS worker export found (expected ingestRSS or runRssWorker)');
  }

  console.log('RSS ingestion completed');
}

run().catch((error) => {
  console.error('[TEST] RSS ingestion failed:', error.message);
  process.exit(1);
});
