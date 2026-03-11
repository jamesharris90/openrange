const { runEarningsEngine } = require('../engines/earningsEngine');
const logger = require('../logger');

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
let timer = null;
let inFlight = false;

async function runEarningsWorker() {
  if (inFlight) {
    return { skipped: true, reason: 'already_running' };
  }

  inFlight = true;
  try {
    const result = await runEarningsEngine();
    logger.info('[EARNINGS_WORKER] run complete', result || {});
    return result;
  } catch (error) {
    logger.error('[EARNINGS_WORKER] run failed', { error: error.message });
    return { skipped: false, error: error.message };
  } finally {
    inFlight = false;
  }
}

function startEarningsWorker() {
  if (timer) return;

  runEarningsWorker().catch(() => null);
  timer = setInterval(() => {
    runEarningsWorker().catch(() => null);
  }, TWELVE_HOURS_MS);
}

module.exports = {
  runEarningsWorker,
  startEarningsWorker,
};
