const cron = require('node-cron');
const logger = require('../logger');
const { evaluateSignals } = require('./backtestEvaluator');

let started = false;
let inFlight = false;

async function runBacktestEvaluationCycle(trigger = 'cron') {
  if (inFlight) {
    logger.warn('backtest evaluation skipped; previous run still in flight', {
      scope: 'backtest_scheduler',
      trigger,
    });
    return {
      ok: true,
      skipped: true,
      reason: 'in_flight',
    };
  }

  inFlight = true;
  try {
    const result = await evaluateSignals({ batchSize: 100 });
    logger.info('backtest evaluation cycle complete', {
      scope: 'backtest_scheduler',
      trigger,
      ...result,
    });
    return result;
  } catch (error) {
    logger.error('backtest evaluation cycle failed', {
      scope: 'backtest_scheduler',
      trigger,
      error: error.message,
    });
    return {
      ok: false,
      error: error.message,
    };
  } finally {
    inFlight = false;
  }
}

function startBacktestScheduler() {
  if (started) return;
  started = true;

  cron.schedule('*/20 * * * *', async () => {
    await runBacktestEvaluationCycle('cron');
  });

  void runBacktestEvaluationCycle('startup');

  logger.info('backtest scheduler started', {
    scope: 'backtest_scheduler',
    schedule: '*/20 * * * *',
    batch_size: 100,
  });
}

module.exports = {
  startBacktestScheduler,
  runBacktestEvaluationCycle,
  getBacktestSchedulerState: () => ({
    started,
    inFlight,
  }),
};
