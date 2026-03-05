const logger = require('../logger');
const { pool } = require('../db/pg');
const {
  ingestMarketQuotesBootstrap,
  ingestMarketQuotesRefresh,
} = require('./fmpMarketIngestion');

let started = false;
let ingestionInterval = null;
let ingestionInFlight = false;
let bootstrapCompleted = false;
const BOOTSTRAP_MIN_ROWS = 2000;

const state = {
  started: false,
  ingestionEverySeconds: 60,
  bootstrapCompleted: false,
  lastIngestionRunAt: null,
  lastIngestionError: null,
  bootstrapTargetRows: BOOTSTRAP_MIN_ROWS,
};

async function safeRun(label, fn) {
  try {
    await fn();
  } catch (error) {
    logger.error('Engine scheduler run failed', {
      engine: label,
      error: error.message,
    });
    throw error;
  }
}

async function runIngestionNow() {
  if (ingestionInFlight) {
    logger.warn('Skipping ingestion run; previous run still in flight');
    return null;
  }

  ingestionInFlight = true;
  state.lastIngestionRunAt = new Date().toISOString();
  try {
    let mode = 'bootstrap';
    let runner = ingestMarketQuotesBootstrap;

    if (bootstrapCompleted) {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM market_quotes');
      const quoteCount = Number(rows?.[0]?.count || 0);
      if (quoteCount < BOOTSTRAP_MIN_ROWS) {
        logger.warn('Refresh skipped during bootstrap gate', {
          quoteCount,
          required: BOOTSTRAP_MIN_ROWS,
        });
        mode = 'bootstrap';
        runner = ingestMarketQuotesBootstrap;
      } else {
        mode = 'refresh';
        runner = ingestMarketQuotesRefresh;
      }
    }

    const result = await safeRun(`fmpMarketIngestion:${mode}`, runner);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM market_quotes');
    const quoteCount = Number(rows?.[0]?.count || 0);
    bootstrapCompleted = quoteCount >= BOOTSTRAP_MIN_ROWS;
    state.bootstrapCompleted = bootstrapCompleted;

    state.lastIngestionError = null;
    return result;
  } catch (error) {
    state.lastIngestionError = error.message;
    return null;
  } finally {
    ingestionInFlight = false;
  }
}

function startEngineScheduler() {
  if (started) return;
  started = true;
  state.started = true;

  ingestionInterval = setInterval(() => {
    runIngestionNow();
  }, state.ingestionEverySeconds * 1000);

  if (typeof ingestionInterval.unref === 'function') ingestionInterval.unref();

  logger.info('Engine scheduler started', {
    ingestionEverySeconds: state.ingestionEverySeconds,
    mode: 'ingestion_only',
  });
}

function getEngineSchedulerStatus() {
  return {
    ...state,
    ingestionTimerActive: Boolean(ingestionInterval),
    metricsTimerActive: false,
  };
}

module.exports = {
  startEngineScheduler,
  runIngestionNow,
  getEngineSchedulerStatus,
};
