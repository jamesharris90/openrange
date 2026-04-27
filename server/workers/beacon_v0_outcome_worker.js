const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
  override: false,
});

const {
  findPicksNeedingCapture,
  capturePickOutcome,
  markOutcomeCompleteIfDone,
} = require('../beacon-v0/outcomes/captureOutcome');
const { pool } = require('../db/pg');

const OUTCOME_CAPTURE_CONCURRENCY = 3;

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;

  async function runNext() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}

async function runOutcomeCapture(checkpointNumber) {
  const startedAt = Date.now();
  const checkpoint = Number(checkpointNumber);
  let picks = [];
  let picksCaptured = 0;
  let picksFailed = 0;

  try {
    picks = await findPicksNeedingCapture(checkpoint);
  } catch (error) {
    picksFailed = 1;
    const summary = {
      checkpoint,
      picks_found: 0,
      picks_captured: 0,
      picks_failed: picksFailed,
      duration_ms: Date.now() - startedAt,
      error: error.message,
    };
    console.error('[beacon-v0-outcomes] failed to find picks', summary);
    return summary;
  }

  await runWithConcurrency(picks, OUTCOME_CAPTURE_CONCURRENCY, async (pick) => {
    try {
      const result = await capturePickOutcome(pick, checkpoint);
      await markOutcomeCompleteIfDone(pick.id);
      if (result?.captured) {
        picksCaptured += 1;
      }
      return result;
    } catch (error) {
      picksFailed += 1;
      console.warn('[beacon-v0-outcomes] per-pick capture failed', {
        checkpoint,
        pick_id: pick.id,
        symbol: pick.symbol,
        error: error.message,
      });
      return { captured: false, failed: true, error: error.message };
    }
  });

  const summary = {
    checkpoint,
    picks_found: picks.length,
    picks_captured: picksCaptured,
    picks_failed: picksFailed,
    duration_ms: Date.now() - startedAt,
  };
  console.log('[beacon-v0-outcomes] capture complete', summary);
  return summary;
}

async function main() {
  const checkpoint = Number(process.argv[2] || 1);
  await runOutcomeCapture(checkpoint);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('[beacon-v0-outcome-worker] Failed:', error.stack || error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}

module.exports = {
  runOutcomeCapture,
};
