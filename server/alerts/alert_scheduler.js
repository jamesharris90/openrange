const logger = require('../logger');
const { runAlertCycle } = require('./alert_engine');
const { queryWithTimeout } = require('../db/pg');

let intervalHandle = null;
let retryHandle = null;
const schedulerState = {
  started: false,
  databaseReady: false,
  intervalSeconds: 60,
  retrySeconds: 30,
  lastTickAt: null,
  lastSuccessAt: null,
  lastError: null,
};

async function checkAlertTablesReady() {
  const { rows } = await queryWithTimeout(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('user_alerts', 'alert_history')`,
    [],
    { timeoutMs: 4000, label: 'alert.scheduler.table_check' }
  );

  const found = new Set(rows.map((row) => row.table_name));
  return found.has('user_alerts') && found.has('alert_history');
}

function clearRetryHandle() {
  if (!retryHandle) return;
  clearTimeout(retryHandle);
  retryHandle = null;
}

function scheduleStartupRetry() {
  clearRetryHandle();
  retryHandle = setTimeout(() => {
    retryHandle = null;
    startAlertScheduler();
  }, schedulerState.retrySeconds * 1000);
  if (typeof retryHandle.unref === 'function') {
    retryHandle.unref();
  }
}

async function startAlertScheduler() {
  if (intervalHandle) return intervalHandle;

  schedulerState.started = true;

  try {
    const databaseReady = await checkAlertTablesReady();
    schedulerState.databaseReady = databaseReady;
    if (!databaseReady) {
      schedulerState.lastError = 'Required alert tables are missing';
      logger.warn('Alert scheduler delayed: required tables not ready (user_alerts, alert_history). Retrying startup.', {
        retrySeconds: schedulerState.retrySeconds,
      });
      scheduleStartupRetry();
      return null;
    }
  } catch (error) {
    schedulerState.databaseReady = false;
    schedulerState.lastError = error.message;
    logger.warn('Alert scheduler delayed: database not ready. Retrying startup.', {
      error: error.message,
      retrySeconds: schedulerState.retrySeconds,
    });
    scheduleStartupRetry();
    return null;
  }

  clearRetryHandle();

  const tick = async () => {
    schedulerState.lastTickAt = new Date().toISOString();
    try {
      const summary = await runAlertCycle();
      schedulerState.lastSuccessAt = new Date().toISOString();
      schedulerState.lastError = null;
      logger.info('Alert scheduler tick complete', {
        activeAlerts: summary.activeAlerts,
        checkedAt: summary.checkedAt,
      });
    } catch (error) {
      schedulerState.lastError = error.message;
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
  clearRetryHandle();
  schedulerState.started = false;
  schedulerState.databaseReady = false;
  logger.info('Alert scheduler stopped');
}

function getAlertSchedulerStatus() {
  return {
    ...schedulerState,
    running: Boolean(intervalHandle),
  };
}

module.exports = {
  startAlertScheduler,
  stopAlertScheduler,
  getAlertSchedulerStatus,
};
