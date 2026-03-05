const logger = require('../logger');
const { pool } = require('../db/pg');
const {
  ingestMarketQuotesBootstrap,
  ingestMarketQuotesRefresh,
} = require('./fmpMarketIngestion');
const { runMetricsEngine } = require('./metricsEngine');
const { runUniverseBuilder } = require('./universeBuilder');
const { runSectorEngine } = require('./sectorEngine');
const { runOpportunityEngine } = require('./opportunityEngine');
const { runStrategyEngine } = require('./strategyEngine');
const { runEarningsEngine } = require('./earningsEngine');
const { runExpectedMoveEngine } = require('./expectedMoveEngine');
const { runIntelNewsEngine } = require('./intelNewsEngine');

let started = false;
let ingestionInterval = null;
let metricsInterval = null;
let sectorInterval = null;
let opportunityInterval = null;
let earningsInterval = null;
let expectedMoveInterval = null;
let intelNewsInterval = null;
let ingestionInFlight = false;
let metricsInFlight = false;
let universeInFlight = false;
let sectorInFlight = false;
let opportunityInFlight = false;
let strategyInFlight = false;
let earningsInFlight = false;
let expectedMoveInFlight = false;
let intelNewsInFlight = false;
let bootstrapCompleted = false;
const BOOTSTRAP_MIN_ROWS = 2000;

const state = {
  started: false,
  ingestionEverySeconds: 60,
  metricsEverySeconds: 60,
  universeEverySeconds: 60,
  sectorEverySeconds: 120,
  opportunityEverySeconds: 60,
  strategyEverySeconds: 60,
  earningsEverySeconds: 3600,
  expectedMoveEverySeconds: 300,
  intelNewsEverySeconds: 300,
  bootstrapCompleted: false,
  lastIngestionRunAt: null,
  lastIngestionError: null,
  lastMetricsRunAt: null,
  lastMetricsError: null,
  lastUniverseRunAt: null,
  lastUniverseError: null,
  lastSectorRunAt: null,
  lastSectorError: null,
  lastOpportunityRunAt: null,
  lastOpportunityError: null,
  lastStrategyRunAt: null,
  lastStrategyError: null,
  lastEarningsRunAt: null,
  lastEarningsError: null,
  lastExpectedMoveRunAt: null,
  lastExpectedMoveError: null,
  lastIntelNewsRunAt: null,
  lastIntelNewsError: null,
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

async function runMetricsNow() {
  if (metricsInFlight) {
    logger.warn('Skipping metrics run; previous run still in flight');
    return null;
  }

  metricsInFlight = true;
  state.lastMetricsRunAt = new Date().toISOString();
  try {
    const result = await safeRun('metricsEngine', runMetricsEngine);
    state.lastMetricsError = null;
    return result;
  } catch (error) {
    state.lastMetricsError = error.message;
    return null;
  } finally {
    metricsInFlight = false;
  }
}

async function runUniverseNow() {
  if (universeInFlight) {
    logger.warn('Skipping universe run; previous run still in flight');
    return null;
  }

  universeInFlight = true;
  state.lastUniverseRunAt = new Date().toISOString();
  try {
    const result = await safeRun('universeBuilder', runUniverseBuilder);
    state.lastUniverseError = null;
    return result;
  } catch (error) {
    state.lastUniverseError = error.message;
    return null;
  } finally {
    universeInFlight = false;
  }
}

async function runSectorNow() {
  if (sectorInFlight) {
    logger.warn('Skipping sector run; previous run still in flight');
    return null;
  }

  sectorInFlight = true;
  state.lastSectorRunAt = new Date().toISOString();
  try {
    const result = await safeRun('sectorEngine', runSectorEngine);
    state.lastSectorError = null;
    return result;
  } catch (error) {
    state.lastSectorError = error.message;
    return null;
  } finally {
    sectorInFlight = false;
  }
}

async function runOpportunityNow() {
  if (opportunityInFlight) {
    logger.warn('Skipping opportunity run; previous run still in flight');
    return null;
  }

  opportunityInFlight = true;
  state.lastOpportunityRunAt = new Date().toISOString();
  try {
    const result = await safeRun('opportunityEngine', runOpportunityEngine);
    state.lastOpportunityError = null;
    return result;
  } catch (error) {
    state.lastOpportunityError = error.message;
    return null;
  } finally {
    opportunityInFlight = false;
  }
}

async function runStrategyNow() {
  if (strategyInFlight) {
    logger.warn('Skipping strategy run; previous run still in flight');
    return null;
  }

  strategyInFlight = true;
  state.lastStrategyRunAt = new Date().toISOString();
  try {
    const result = await safeRun('strategyEngine', runStrategyEngine);
    state.lastStrategyError = null;
    return result;
  } catch (error) {
    state.lastStrategyError = error.message;
    return null;
  } finally {
    strategyInFlight = false;
  }
}

async function runEarningsNow() {
  if (earningsInFlight) {
    logger.warn('Skipping earnings run; previous run still in flight');
    return null;
  }

  earningsInFlight = true;
  state.lastEarningsRunAt = new Date().toISOString();
  try {
    const result = await safeRun('earningsEngine', runEarningsEngine);
    state.lastEarningsError = null;
    return result;
  } catch (error) {
    state.lastEarningsError = error.message;
    return null;
  } finally {
    earningsInFlight = false;
  }
}

async function runExpectedMoveNow() {
  if (expectedMoveInFlight) {
    logger.warn('Skipping expected move run; previous run still in flight');
    return null;
  }

  expectedMoveInFlight = true;
  state.lastExpectedMoveRunAt = new Date().toISOString();
  try {
    const result = await safeRun('expectedMoveEngine', runExpectedMoveEngine);
    state.lastExpectedMoveError = null;
    return result;
  } catch (error) {
    state.lastExpectedMoveError = error.message;
    return null;
  } finally {
    expectedMoveInFlight = false;
  }
}

async function runIntelNewsNow() {
  if (intelNewsInFlight) {
    logger.warn('Skipping intel news run; previous run still in flight');
    return null;
  }

  intelNewsInFlight = true;
  state.lastIntelNewsRunAt = new Date().toISOString();
  try {
    const result = await safeRun('intelNewsEngine', runIntelNewsEngine);
    state.lastIntelNewsError = null;
    return result;
  } catch (error) {
    state.lastIntelNewsError = error.message;
    return null;
  } finally {
    intelNewsInFlight = false;
  }
}

async function runUniverseBuilderNow() {
  return runUniverseNow();
}

async function runStrategyEngineNow() {
  return runStrategyNow();
}

async function runCorePipelineNow() {
  await runMetricsNow();
  await runUniverseBuilderNow();
  await runStrategyEngineNow();
}

function startEngineScheduler() {
  if (started) return;
  started = true;
  state.started = true;

  ingestionInterval = setInterval(() => {
    runIngestionNow();
  }, state.ingestionEverySeconds * 1000);

  metricsInterval = setInterval(() => {
    runCorePipelineNow();
  }, state.metricsEverySeconds * 1000);

  sectorInterval = setInterval(() => {
    runSectorNow();
  }, state.sectorEverySeconds * 1000);

  opportunityInterval = setInterval(() => {
    runOpportunityNow();
  }, state.opportunityEverySeconds * 1000);


  earningsInterval = setInterval(() => {
    runEarningsNow();
  }, state.earningsEverySeconds * 1000);

  expectedMoveInterval = setInterval(() => {
    runExpectedMoveNow();
  }, state.expectedMoveEverySeconds * 1000);

  intelNewsInterval = setInterval(() => {
    runIntelNewsNow();
  }, state.intelNewsEverySeconds * 1000);

  if (typeof ingestionInterval.unref === 'function') ingestionInterval.unref();
  if (typeof metricsInterval.unref === 'function') metricsInterval.unref();
  if (typeof sectorInterval.unref === 'function') sectorInterval.unref();
  if (typeof opportunityInterval.unref === 'function') opportunityInterval.unref();
  if (typeof earningsInterval.unref === 'function') earningsInterval.unref();
  if (typeof expectedMoveInterval.unref === 'function') expectedMoveInterval.unref();
  if (typeof intelNewsInterval.unref === 'function') intelNewsInterval.unref();

  runCorePipelineNow();
  runSectorNow();
  runOpportunityNow();
  runEarningsNow();
  runExpectedMoveNow();
  runIntelNewsNow();

  logger.info('Engine scheduler started', {
    ingestionEverySeconds: state.ingestionEverySeconds,
    metricsEverySeconds: state.metricsEverySeconds,
    universeEverySeconds: state.universeEverySeconds,
    sectorEverySeconds: state.sectorEverySeconds,
    opportunityEverySeconds: state.opportunityEverySeconds,
    strategyEverySeconds: state.strategyEverySeconds,
    earningsEverySeconds: state.earningsEverySeconds,
    expectedMoveEverySeconds: state.expectedMoveEverySeconds,
    intelNewsEverySeconds: state.intelNewsEverySeconds,
    mode: 'phase_2_intelligence',
  });
}

function getEngineSchedulerStatus() {
  return {
    ...state,
    ingestionTimerActive: Boolean(ingestionInterval),
    metricsTimerActive: Boolean(metricsInterval),
    universeTimerActive: Boolean(metricsInterval),
    sectorTimerActive: Boolean(sectorInterval),
    opportunityTimerActive: Boolean(opportunityInterval),
    strategyTimerActive: Boolean(metricsInterval),
    earningsTimerActive: Boolean(earningsInterval),
    expectedMoveTimerActive: Boolean(expectedMoveInterval),
    intelNewsTimerActive: Boolean(intelNewsInterval),
  };
}

module.exports = {
  startEngineScheduler,
  runIngestionNow,
  runMetricsNow,
  runCorePipelineNow,
  runUniverseNow,
  runUniverseBuilderNow,
  runSectorNow,
  runOpportunityNow,
  runStrategyNow,
  runStrategyEngineNow,
  runEarningsNow,
  runExpectedMoveNow,
  runIntelNewsNow,
  getEngineSchedulerStatus,
};
