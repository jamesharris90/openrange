const logger = require('../logger');
const cron = require('node-cron');
const { poolWrite, runWithDbPool } = require('../db/pg');
const {
  ingestMarketQuotesBootstrap,
  ingestMarketQuotesRefresh,
} = require('./fmpMarketIngestion');
const { runMetricsEngine } = require('./metricsEngine');
const { runUniverseBuilder } = require('./universeBuilder');
const { runSectorEngine } = require('./sectorEngine');
const { runOpportunityEngine } = require('./opportunityEngine');
const { runFlowDetectionEngine } = require('./flowDetectionEngine');
const { runShortSqueezeEngine } = require('./shortSqueezeEngine');
const { runMarketNarrativeEngine } = require('./marketNarrativeEngine');
const { runStrategyEngine } = require('./strategyEngine');
const { runTrendDetectionEngine } = require('./trendDetectionEngine');
const { runEarningsEngine } = require('./earningsEngine');
const { runExpectedMoveEngine } = require('./expectedMoveEngine');
const { runIntelNewsWithFallback } = require('../services/intelNewsRunner');
const safeEngineRun = require('../utils/engineSafeRun');
const { heartbeat } = require('../system/pipelineWatchdog');
const { startTrace, traceStep, endTrace } = require('../system/traceBus');
const { publish } = require('../system/eventBus');
const {
  registerEngine,
  startAllEngines,
} = require('../system/engineSupervisor');
const { recordEngineTelemetry, logSystemAlert, normalizeRowsProcessed } = require('../system/engineOps');
const { sendPremarketScanEmail } = require('../services/emailService');
const { runBeaconEngine } = require('./beaconEngine');
const { runBeaconLearningEngine } = require('./beaconLearningEngine');
const { runBeaconOptimizer } = require('./beaconOptimizer');
const { runMarketContextEngine } = require('./marketContextEngine');
const { runSectorRotationEngine } = require('./sectorRotationEngine');
const { runTradeNarrativeEngine } = require('./tradeNarrativeEngine');

let started = false;
let ingestionInterval = null;
let metricsInterval = null;
let sectorInterval = null;
let opportunityInterval = null;
let trendInterval = null;
let earningsInterval = null;
let expectedMoveInterval = null;
let intelNewsInterval = null;
let ingestionInFlight = false;
let metricsInFlight = false;
let universeInFlight = false;
let sectorInFlight = false;
let opportunityInFlight = false;
let strategyInFlight = false;
let trendInFlight = false;
let earningsInFlight = false;
let expectedMoveInFlight = false;
let intelNewsInFlight = false;
let schedulerInFlight = false;
let beaconInFlight = false;
let beaconLearningInFlight = false;
let beaconOptimizerInFlight = false;
let marketContextInFlight = false;
let sectorRotationInFlight = false;
let tradeNarrativeInFlight = false;
let bootstrapCompleted = false;
let schedulerCronJob = null;
let premarketScanCronJob = null;
let beaconCronJob = null;
let beaconLearningCronJob = null;
let beaconOptimizerCronJob = null;
let marketContextCronJob = null;
let sectorRotationCronJob = null;
let tradeNarrativeCronJob = null;
const BOOTSTRAP_MIN_ROWS = 2000;
const ENGINE_DELAY_MS = 1500;

const state = {
  started: false,
  ingestionEverySeconds: 60,
  metricsEverySeconds: 60,
  universeEverySeconds: 60,
  sectorEverySeconds: 120,
  opportunityEverySeconds: 60,
  strategyEverySeconds: 60,
  trendEverySeconds: 300,
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
  lastTrendRunAt: null,
  lastTrendError: null,
  lastEarningsRunAt: null,
  lastEarningsError: null,
  lastExpectedMoveRunAt: null,
  lastExpectedMoveError: null,
  lastIntelNewsRunAt: null,
  lastIntelNewsError: null,
  lastBeaconRunAt: null,
  lastBeaconError: null,
  lastBeaconLearningRunAt: null,
  lastBeaconLearningError: null,
  lastBeaconOptimizerRunAt: null,
  lastBeaconOptimizerError: null,
  lastMarketContextRunAt: null,
  lastMarketContextError: null,
  lastSectorRotationRunAt: null,
  lastSectorRotationError: null,
  lastTradeNarrativeRunAt: null,
  lastTradeNarrativeError: null,
  bootstrapTargetRows: BOOTSTRAP_MIN_ROWS,
};

async function safeRun(label, fn) {
  const startedAt = Date.now();

  const extractRowsProcessed = (value) => {
    if (Number.isFinite(Number(value))) return Number(value);
    if (!value || typeof value !== 'object') return 0;

    const candidates = [
      value.rows_processed,
      value.rowsProcessed,
      value.inserted,
      value.count,
      value.total,
      value.rowCount,
    ];

    const first = candidates.find((item) => Number.isFinite(Number(item)));
    return Number.isFinite(Number(first)) ? Number(first) : 0;
  };

  try {
    const result = await runWithDbPool('write', fn);

    await recordEngineTelemetry({
      engineName: label,
      status: 'ok',
      rowsProcessed: normalizeRowsProcessed(extractRowsProcessed(result)),
      runtimeMs: Date.now() - startedAt,
    });

    return result;
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    const isExpectedMoveMissingColumn =
      label === 'expectedMoveEngine' && message.includes('atr_percent') && message.includes('does not exist');
    const isEarningsEnsureColumnsTimeout =
      label === 'earningsEngine' && message.includes('timeout') && message.includes('ensure_columns');

    if (isExpectedMoveMissingColumn || isEarningsEnsureColumnsTimeout) {
      logger.warn('Engine scheduler run warning', {
        engine: label,
        error: error.message,
      });
    } else {
      logger.error('Engine scheduler run failed', {
        engine: label,
        error: error.message,
      });
    }

    await recordEngineTelemetry({
      engineName: label,
      status: 'failed',
      rowsProcessed: 0,
      runtimeMs: Date.now() - startedAt,
      details: {
        error: error.message,
      },
    });

    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: label,
      severity: 'high',
      message: `${label} failed: ${error.message}`,
    });

    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      const { rows } = await poolWrite.query('SELECT COUNT(*)::int AS count FROM market_quotes');
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

    const { rows } = await poolWrite.query('SELECT COUNT(*)::int AS count FROM market_quotes');
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

async function runTrendNow() {
  if (trendInFlight) {
    logger.warn('Skipping trend detection run; previous run still in flight');
    return null;
  }

  trendInFlight = true;
  state.lastTrendRunAt = new Date().toISOString();
  try {
    const result = await safeRun('trendDetectionEngine', runTrendDetectionEngine);
    state.lastTrendError = null;
    return result;
  } catch (error) {
    state.lastTrendError = error.message;
    return null;
  } finally {
    trendInFlight = false;
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
    const result = await safeRun('intelNewsEngine', runIntelNewsWithFallback);
    state.lastIntelNewsError = null;
    return result;
  } catch (error) {
    state.lastIntelNewsError = error.message;
    return null;
  } finally {
    intelNewsInFlight = false;
  }
}

async function runBeaconNow() {
  if (beaconInFlight) {
    logger.warn('Skipping beacon run; previous run still in flight');
    return null;
  }

  beaconInFlight = true;
  state.lastBeaconRunAt = new Date().toISOString();
  try {
    const result = await safeRun('beaconEngine', runBeaconEngine);
    state.lastBeaconError = null;
    return result;
  } catch (error) {
    state.lastBeaconError = error.message;
    return null;
  } finally {
    beaconInFlight = false;
  }
}

async function runBeaconLearningNow() {
  if (beaconLearningInFlight) {
    logger.warn('Skipping beacon learning run; previous run still in flight');
    return null;
  }

  beaconLearningInFlight = true;
  state.lastBeaconLearningRunAt = new Date().toISOString();
  try {
    const result = await safeRun('beaconLearningEngine', runBeaconLearningEngine);
    state.lastBeaconLearningError = null;
    return result;
  } catch (error) {
    state.lastBeaconLearningError = error.message;
    return null;
  } finally {
    beaconLearningInFlight = false;
  }
}

async function runBeaconOptimizerNow() {
  if (beaconOptimizerInFlight) {
    logger.warn('Skipping beacon optimizer run; previous run still in flight');
    return null;
  }

  beaconOptimizerInFlight = true;
  state.lastBeaconOptimizerRunAt = new Date().toISOString();
  try {
    const result = await safeRun('beaconOptimizer', runBeaconOptimizer);
    state.lastBeaconOptimizerError = null;
    return result;
  } catch (error) {
    state.lastBeaconOptimizerError = error.message;
    return null;
  } finally {
    beaconOptimizerInFlight = false;
  }
}

async function runMarketContextNow() {
  if (marketContextInFlight) {
    logger.warn('Skipping market context run; previous run still in flight');
    return null;
  }

  marketContextInFlight = true;
  state.lastMarketContextRunAt = new Date().toISOString();
  try {
    const result = await safeRun('marketContextEngine', runMarketContextEngine);
    state.lastMarketContextError = null;
    return result;
  } catch (error) {
    state.lastMarketContextError = error.message;
    return null;
  } finally {
    marketContextInFlight = false;
  }
}

async function runSectorRotationNow() {
  if (sectorRotationInFlight) {
    logger.warn('Skipping sector rotation run; previous run still in flight');
    return null;
  }

  sectorRotationInFlight = true;
  state.lastSectorRotationRunAt = new Date().toISOString();
  try {
    const result = await safeRun('sectorRotationEngine', runSectorRotationEngine);
    state.lastSectorRotationError = null;
    return result;
  } catch (error) {
    state.lastSectorRotationError = error.message;
    return null;
  } finally {
    sectorRotationInFlight = false;
  }
}

async function runTradeNarrativeNow() {
  if (tradeNarrativeInFlight) {
    logger.warn('Skipping trade narrative run; previous run still in flight');
    return null;
  }

  tradeNarrativeInFlight = true;
  state.lastTradeNarrativeRunAt = new Date().toISOString();
  try {
    const result = await safeRun('tradeNarrativeEngine', runTradeNarrativeEngine);
    state.lastTradeNarrativeError = null;
    return result;
  } catch (error) {
    state.lastTradeNarrativeError = error.message;
    return null;
  } finally {
    tradeNarrativeInFlight = false;
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
  await sleep(ENGINE_DELAY_MS);
  await runUniverseBuilderNow();
  await sleep(ENGINE_DELAY_MS);
  await runStrategyEngineNow();
}

async function runSchedulerCycleNow() {
  if (schedulerInFlight) {
    logger.warn('Skipping scheduler cycle; previous cycle still in flight');
    return;
  }

  schedulerInFlight = true;
  try {
    // Requested sequential order with small delay to reduce DB contention.
    await runIntelNewsNow();
    await sleep(ENGINE_DELAY_MS);

    await runIngestionNow();
    await sleep(ENGINE_DELAY_MS);

    await runEarningsNow();
    await sleep(ENGINE_DELAY_MS);

    await runStrategyEngineNow();
    await sleep(ENGINE_DELAY_MS);

    // Keep existing supporting engines in the same sequential cycle.
    await runMetricsNow();
    await sleep(ENGINE_DELAY_MS);

    await runUniverseBuilderNow();
    await sleep(ENGINE_DELAY_MS);

    await runSectorNow();
    await sleep(ENGINE_DELAY_MS);

    await runOpportunityNow();
    await sleep(ENGINE_DELAY_MS);

    await runTrendNow();
    await sleep(ENGINE_DELAY_MS);

    await runExpectedMoveNow();
  } finally {
    schedulerInFlight = false;
  }
}

async function runPipeline() {
  const traceId = startTrace('scheduler.pipeline');
  publish('pipeline:cycle:start', { traceId, at: new Date().toISOString() });

  try {
    heartbeat();
    traceStep(traceId, 'heartbeat');

    await safeEngineRun('ingestion', runIngestionNow);
    traceStep(traceId, 'ingestion');

    await safeEngineRun('news', runIntelNewsNow);
    traceStep(traceId, 'news');

    await safeEngineRun('opportunity', runOpportunityNow);
    traceStep(traceId, 'opportunity');

    await safeEngineRun('flow', runFlowDetectionEngine);
    traceStep(traceId, 'flow');

    await safeEngineRun('squeeze', runShortSqueezeEngine);
    traceStep(traceId, 'squeeze');

    // Keep existing sequential scheduler cycle for full engine coverage.
    await runSchedulerCycleNow();
    traceStep(traceId, 'scheduler_cycle');
    publish('pipeline:cycle:done', { traceId, at: new Date().toISOString() });
  } catch (error) {
    publish('pipeline:cycle:error', { traceId, error: error.message, at: new Date().toISOString() });
    throw error;
  } finally {
    endTrace(traceId);
  }
}

async function runPremarketScanAndEmail() {
  try {
    const { rows } = await poolWrite.query(
      `SELECT
         symbol,
         strategy,
         probability,
         gap_percent,
         relative_volume
       FROM strategy_signals
       WHERE gap_percent > 2
         AND relative_volume > 1.5
       ORDER BY probability DESC
       LIMIT 20`
    );

    await sendPremarketScanEmail(rows || [], 'intelligence@openrangetrading.co.uk');

    await recordEngineTelemetry({
      engineName: 'premarket_scan_email',
      status: 'ok',
      rowsProcessed: normalizeRowsProcessed((rows || []).length),
      runtimeMs: 0,
    });

    logger.info('Premarket scan email sent', {
      rows: (rows || []).length,
    });
  } catch (error) {
    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: 'premarket_scan_email',
      severity: 'high',
      message: `Premarket scan email failed: ${error.message}`,
    }).catch(() => null);

    logger.error('Premarket scan email failed', { error: error.message });
  }
}

function startEngineScheduler() {
  if (started) return;
  started = true;
  state.started = true;

  registerEngine('ingestion', runIngestionNow);
  registerEngine('news', runIntelNewsNow);
  registerEngine('opportunity', runOpportunityNow);
  registerEngine('flow', runFlowDetectionEngine);
  registerEngine('squeeze', runShortSqueezeEngine);
  registerEngine('marketNarrative', runMarketNarrativeEngine);

  startAllEngines();

  schedulerCronJob = cron.schedule('* * * * *', () => {
    runPipeline();
  });

  premarketScanCronJob = cron.schedule('0 7 * * *', () => {
    runPremarketScanAndEmail();
  }, {
    timezone: 'Europe/London',
  });

  if (!beaconCronJob) {
    beaconCronJob = cron.schedule('*/5 * * * *', () => {
      runBeaconNow();
    });
  }

  if (!beaconLearningCronJob) {
    beaconLearningCronJob = cron.schedule('10 0 * * *', () => {
      runBeaconLearningNow();
    }, {
      timezone: 'Europe/London',
    });
  }

  if (!beaconOptimizerCronJob) {
    beaconOptimizerCronJob = cron.schedule('20 0 * * 0', () => {
      runBeaconOptimizerNow();
    }, {
      timezone: 'Europe/London',
    });
  }

  if (!marketContextCronJob) {
    marketContextCronJob = cron.schedule('*/5 * * * *', () => {
      runMarketContextNow();
    });
  }

  if (!sectorRotationCronJob) {
    sectorRotationCronJob = cron.schedule('*/5 * * * *', () => {
      runSectorRotationNow();
    });
  }

  if (!tradeNarrativeCronJob) {
    tradeNarrativeCronJob = cron.schedule('*/5 * * * *', () => {
      runTradeNarrativeNow();
    });
  }

  runPipeline();
  runBeaconNow();
  runMarketContextNow();
  runSectorRotationNow();
  runTradeNarrativeNow();

  logger.info('Engine scheduler started', {
    ingestionEverySeconds: state.ingestionEverySeconds,
    metricsEverySeconds: state.metricsEverySeconds,
    universeEverySeconds: state.universeEverySeconds,
    sectorEverySeconds: state.sectorEverySeconds,
    opportunityEverySeconds: state.opportunityEverySeconds,
    strategyEverySeconds: state.strategyEverySeconds,
    trendEverySeconds: state.trendEverySeconds,
    earningsEverySeconds: state.earningsEverySeconds,
    expectedMoveEverySeconds: state.expectedMoveEverySeconds,
    intelNewsEverySeconds: state.intelNewsEverySeconds,
    mode: 'phase_2_intelligence',
    schedule: '* * * * *',
    premarketScanSchedule: '0 7 * * * Europe/London',
    beaconSchedule: '*/5 * * * *',
    beaconLearningSchedule: '10 0 * * * Europe/London',
    beaconOptimizerSchedule: '20 0 * * 0 Europe/London',
    marketContextSchedule: '*/5 * * * *',
    sectorRotationSchedule: '*/5 * * * *',
    tradeNarrativeSchedule: '*/5 * * * *',
  });
}

function getEngineSchedulerStatus() {
  return {
    ...state,
    ingestionTimerActive: false,
    metricsTimerActive: Boolean(metricsInterval),
    universeTimerActive: Boolean(metricsInterval),
    sectorTimerActive: Boolean(metricsInterval),
    opportunityTimerActive: Boolean(metricsInterval),
    strategyTimerActive: Boolean(metricsInterval),
    trendTimerActive: Boolean(metricsInterval),
    earningsTimerActive: Boolean(metricsInterval),
    expectedMoveTimerActive: Boolean(metricsInterval),
    intelNewsTimerActive: Boolean(metricsInterval),
    cronTimerActive: Boolean(schedulerCronJob),
    premarketScanTimerActive: Boolean(premarketScanCronJob),
    beaconTimerActive: Boolean(beaconCronJob),
    beaconLearningTimerActive: Boolean(beaconLearningCronJob),
    beaconOptimizerTimerActive: Boolean(beaconOptimizerCronJob),
    marketContextTimerActive: Boolean(marketContextCronJob),
    sectorRotationTimerActive: Boolean(sectorRotationCronJob),
    tradeNarrativeTimerActive: Boolean(tradeNarrativeCronJob),
    schedulerSequentialMode: true,
    engineDelayMs: ENGINE_DELAY_MS,
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
  runTrendNow,
  runEarningsNow,
  runExpectedMoveNow,
  runIntelNewsNow,
  runBeaconNow,
  runBeaconLearningNow,
  runBeaconOptimizerNow,
  runMarketContextNow,
  runSectorRotationNow,
  runTradeNarrativeNow,
  runPipeline,
  getEngineSchedulerStatus,
};
