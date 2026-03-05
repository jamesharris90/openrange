const logger = require('../logger');
const { runAlertCycle } = require('./alert_engine');

let intervalHandle = null;

function startAlertScheduler() {
  if (intervalHandle) return intervalHandle;

  const tick = async () => {
    try {
      const summary = await runAlertCycle();
      logger.info('Alert scheduler tick complete', {
        activeAlerts: summary.activeAlerts,
        checkedAt: summary.checkedAt,
      });
    } catch (error) {
      logger.error('Alert scheduler tick failed', { error: error.message });
    }
  };

  tick();
  intervalHandle = setInterval(tick, 60 * 1000);

  if (typeof intervalHandle.unref === 'function') {
    intervalHandle.unref();
  }

  logger.info('Alert scheduler started', { intervalSeconds: 60 });
  return intervalHandle;
}

function stopAlertScheduler() {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('Alert scheduler stopped');
}

module.exports = {
  startAlertScheduler,
  stopAlertScheduler,
};
