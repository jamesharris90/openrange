const cron = require('node-cron');
const logger = require('../logger');
const { calculateMarketMetrics } = require('./calc_market_metrics');

let started = false;

async function runCycle(trigger = 'scheduler') {
  try {
    const result = await calculateMarketMetrics();
    logger.info('metrics cycle complete', {
      scope: 'metrics',
      trigger,
      ...result,
    });
    return result;
  } catch (err) {
    logger.error('metrics cycle failed', {
      scope: 'metrics',
      trigger,
      error: err.message,
    });
    return {
      symbols: 0,
      processedSymbols: 0,
      writtenRows: 0,
      failedBatches: 1,
      runtimeMs: 0,
      errors: 1,
      error: err.message,
    };
  }
}

function startMetricsScheduler() {
  if (started) return;
  started = true;

  cron.schedule('*/1 * * * *', async () => {
    await runCycle('cron');
  });

  logger.info('metrics scheduler started', {
    scope: 'metrics',
    schedule: '*/1 * * * *',
  });
}

module.exports = {
  runCycle,
  startMetricsScheduler,
};
