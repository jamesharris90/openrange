const cron = require('node-cron');
const logger = require('../logger');
const { runDiscoveryEngine } = require('./discovery_engine');

let started = false;

async function runDiscoveryCycle(trigger = 'scheduler') {
  try {
    const result = await runDiscoveryEngine();

    logger.info('discovery cycle complete', {
      scope: 'discovery',
      trigger,
      ...result,
    });

    return result;
  } catch (err) {
    logger.error('discovery cycle failed', {
      scope: 'discovery',
      trigger,
      error: err.message,
    });

    return {
      symbols_detected: 0,
      symbols_upserted: 0,
      runtimeMs: 0,
      error: err.message,
    };
  }
}

function startDiscoveryScheduler() {
  if (started) return;
  started = true;

  cron.schedule('*/1 * * * *', async () => {
    await runDiscoveryCycle('cron');
  });

  logger.info('discovery scheduler started', {
    scope: 'discovery',
    schedule: '*/1 * * * *',
  });
}

module.exports = {
  runDiscoveryCycle,
  startDiscoveryScheduler,
};
