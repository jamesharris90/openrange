const cron = require('node-cron');
const logger = require('../logger');
const { evaluateSignals } = require('../engines/tradeOutcomeEngine');

let started = false;
let inFlight = false;
const isRailwayRuntime = Boolean(
  process.env.RAILWAY_PROJECT_ID
  || process.env.RAILWAY_ENVIRONMENT_ID
  || process.env.RAILWAY_SERVICE_ID
);
const startupDelayMs = Number(process.env.TRADE_OUTCOME_STARTUP_DELAY_MS || (isRailwayRuntime ? 150000 : 0));

async function runTradeOutcomeCycle(trigger = 'cron') {
  if (inFlight) {
    logger.warn('trade outcome evaluation skipped; previous run still in flight', {
      scope: 'trade_outcome_scheduler',
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
    const result = await evaluateSignals();
    logger.info('trade outcome evaluation cycle complete', {
      scope: 'trade_outcome_scheduler',
      trigger,
      ...result,
    });
    return result;
  } catch (error) {
    logger.error('trade outcome evaluation cycle failed', {
      scope: 'trade_outcome_scheduler',
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

function startTradeOutcomeScheduler() {
  if (started) return;
  started = true;

  cron.schedule('*/20 * * * *', async () => {
    await runTradeOutcomeCycle('cron');
  });

  if (startupDelayMs > 0) {
    logger.info('trade outcome scheduler startup run delayed', {
      scope: 'trade_outcome_scheduler',
      startup_delay_ms: startupDelayMs,
    });
    setTimeout(() => {
      void runTradeOutcomeCycle('startup');
    }, startupDelayMs);
  } else {
    void runTradeOutcomeCycle('startup');
  }

  logger.info('trade outcome scheduler started', {
    scope: 'trade_outcome_scheduler',
    schedule: '*/20 * * * *',
  });
}

module.exports = {
  startTradeOutcomeScheduler,
  runTradeOutcomeCycle,
  getTradeOutcomeSchedulerState: () => ({
    started,
    inFlight,
  }),
};