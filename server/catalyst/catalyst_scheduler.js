const cron = require('node-cron');
const logger = require('../logger');
const { runCatalystEngine } = require('./catalyst_engine');

let started = false;

async function runCatalystCycle(trigger = 'scheduler') {
  try {
    const result = await runCatalystEngine();
    logger.info('catalyst cycle complete', {
      scope: 'catalyst',
      trigger,
      ...result,
    });
    return result;
  } catch (err) {
    logger.error('catalyst cycle failed', {
      scope: 'catalyst',
      trigger,
      error: err.message,
    });
    return {
      news_processed: 0,
      catalysts_detected: 0,
      catalysts_upserted: 0,
      runtimeMs: 0,
      error: err.message,
    };
  }
}

function startCatalystScheduler() {
  if (started) return;
  started = true;

  cron.schedule('*/2 * * * *', async () => {
    await runCatalystCycle('cron');
  });

  logger.info('catalyst scheduler started', {
    scope: 'catalyst',
    schedule: '*/2 * * * *',
  });
}

module.exports = {
  runCatalystCycle,
  startCatalystScheduler,
};
