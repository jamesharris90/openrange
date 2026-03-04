const cron = require('node-cron');
const logger = require('../logger');
const { runStrategyEngine } = require('./strategy_engine');

let started = false;

async function runStrategyCycle(trigger = 'scheduler') {
  try {
    const result = await runStrategyEngine();
    logger.info('strategy cycle complete', {
      scope: 'strategy',
      trigger,
      ...result,
    });
    return result;
  } catch (err) {
    logger.error('strategy cycle failed', {
      scope: 'strategy',
      trigger,
      error: err.message,
    });
    return {
      symbols_processed: 0,
      setups_detected: 0,
      runtimeMs: 0,
      error: err.message,
    };
  }
}

function startStrategyScheduler() {
  if (started) return;
  started = true;

  cron.schedule('*/1 * * * *', async () => {
    await runStrategyCycle('cron');
  });

  logger.info('strategy scheduler started', {
    scope: 'strategy',
    schedule: '*/1 * * * *',
  });
}

module.exports = {
  runStrategyCycle,
  startStrategyScheduler,
};
