const cron = require('node-cron');
const logger = require('../logger');
const { runStocksInPlayEngine } = require('./stocksInPlayEngine');
const { runShortSqueezeEngine } = require('./shortSqueezeEngine');
const { runFlowDetectionEngine } = require('./flowDetectionEngine');
const { runOpportunityRanker } = require('./opportunityRanker');
const { runMarketNarrativeEngine } = require('./marketNarrativeEngine');
const { runIsolated } = require('./engineErrorIsolation');
const { runDbSchemaGuard } = require('../db/schemaGuard');
const { runDataIntegrityEngine } = require('./dataIntegrityEngine');
const { updateTelemetry } = require('../cache/telemetryCache');
const eventBus = require('../events/eventBus');
const EVENT_TYPES = require('../events/eventTypes');

const isRailwayRuntime = Boolean(
  process.env.RAILWAY_PROJECT_ID
  || process.env.RAILWAY_ENVIRONMENT_ID
  || process.env.RAILWAY_SERVICE_ID
);
const startupDelayMs = Number(process.env.INTELLIGENCE_PIPELINE_STARTUP_DELAY_MS || (isRailwayRuntime ? 180000 : 0));
let readyAt = 0;

let latestPipelineRun = {
  status: 'idle',
  last_run: null,
  execution_time_ms: 0,
  stages: {},
  validation: [],
  errors: [],
};

function firstNumber(obj, keys) {
  for (const key of keys) {
    const value = Number(obj?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function buildValidationEntry(engine, stage, fetchedKeys, processedKeys, writtenKeys, defaults = {}) {
  const result = stage?.result || {};
  const rowsFetched = firstNumber(result, fetchedKeys) || Number(defaults.rowsFetched || 0);
  const rowsProcessed = firstNumber(result, processedKeys) || Number(defaults.rowsProcessed || 0);
  const rowsWritten = firstNumber(result, writtenKeys) || Number(defaults.rowsWritten || 0);
  const status = stage?.ok === false ? 'failed' : (rowsProcessed === 0 ? 'warning' : 'ok');

  if (rowsProcessed === 0 && stage?.ok !== false) {
    logger.warn('[ENGINE WARNING] no data returned', { engine, rows_fetched: rowsFetched, rows_processed: rowsProcessed, rows_written: rowsWritten });
  }

  logger.info('[ENGINE] validation', {
    engine,
    rows_fetched: rowsFetched,
    rows_processed: rowsProcessed,
    rows_written: rowsWritten,
    status,
  });

  return {
    engine,
    rows_fetched: rowsFetched,
    rows_processed: rowsProcessed,
    rows_written: rowsWritten,
    status,
  };
}

async function runIntelligencePipeline() {
  const startedAt = Date.now();
  const stages = {};
  const errors = [];

  eventBus.emit(EVENT_TYPES.PRICE_UPDATE, {
    source: 'intelligence_pipeline',
    issue: 'pipeline_run_started',
    timestamp: new Date().toISOString(),
  });

  const schemaGuard = await runIsolated('schema_guard_pipeline', runDbSchemaGuard);
  stages.schema_guard = schemaGuard;
  if (!schemaGuard.ok) {
    const detail = schemaGuard.error || schemaGuard.result?.issues?.join('; ') || 'schema guard failed';
    errors.push(`schema_guard: ${detail}`);
    eventBus.emit(EVENT_TYPES.ENGINE_FAILURE, {
      source: 'schema_guard_pipeline',
      issue: 'engine_failure',
      severity: 'high',
      error: detail,
      timestamp: new Date().toISOString(),
    });
  }

  const integrity = await runIsolated('data_integrity_pipeline', runDataIntegrityEngine);
  stages.data_integrity = integrity;
  if (!integrity.ok) {
    errors.push(`data_integrity: ${integrity.error}`);
    eventBus.emit(EVENT_TYPES.ENGINE_FAILURE, {
      source: 'data_integrity_pipeline',
      issue: 'engine_failure',
      severity: 'high',
      error: integrity.error,
      timestamp: new Date().toISOString(),
    });
  }

  const stocks = await runIsolated('stocks_in_play_pipeline', runStocksInPlayEngine);
  stages.stocks_in_play = stocks;
  if (!stocks.ok) {
    errors.push(`stocks_in_play: ${stocks.error}`);
    eventBus.emit(EVENT_TYPES.ENGINE_FAILURE, {
      source: 'stocks_in_play_pipeline',
      issue: 'engine_failure',
      severity: 'high',
      error: stocks.error,
      timestamp: new Date().toISOString(),
    });
  }
  if (stocks.ok) {
    eventBus.emit(EVENT_TYPES.STOCK_IN_PLAY, {
      source: 'stocks_in_play_pipeline',
      count: Number(stocks.result?.selected || stocks.result?.upserted || 0),
      timestamp: new Date().toISOString(),
    });
  }

  const [flow, squeeze, opportunity, narrative] = await Promise.all([
    runIsolated('flow_detection_pipeline', runFlowDetectionEngine),
    runIsolated('short_squeeze_pipeline', runShortSqueezeEngine),
    runIsolated('opportunity_ranker_pipeline', runOpportunityRanker),
    runIsolated('market_narrative_pipeline', runMarketNarrativeEngine),
  ]);

  stages.flow_detection = flow;
  stages.short_squeeze = squeeze;
  stages.opportunity = opportunity;
  stages.market_narrative = narrative;

  const validation = [
    buildValidationEntry('stocks_in_play', stocks, ['selected'], ['selected'], ['upserted']),
    buildValidationEntry('flow_detection', flow, ['scanned'], ['scanned'], ['inserted']),
    buildValidationEntry('short_squeeze', squeeze, ['scanned'], ['scanned'], ['inserted']),
    buildValidationEntry('opportunity_ranker', opportunity, ['ranked'], ['ranked'], ['ranked']),
    buildValidationEntry('market_narrative', narrative, [], [], [], {
      rowsFetched: narrative?.ok ? 1 : 0,
      rowsProcessed: narrative?.ok ? 1 : 0,
      rowsWritten: narrative?.ok ? 1 : 0,
    }),
  ];

  if (!flow.ok) {
    errors.push(`flow_detection: ${flow.error}`);
    eventBus.emit(EVENT_TYPES.ENGINE_FAILURE, {
      source: 'flow_detection_pipeline',
      issue: 'engine_failure',
      severity: 'high',
      error: flow.error,
      timestamp: new Date().toISOString(),
    });
  } else {
    eventBus.emit(EVENT_TYPES.FLOW_DETECTED, {
      source: 'flow_detection_pipeline',
      count: Number(flow.result?.inserted || 0),
      timestamp: new Date().toISOString(),
    });
  }

  if (!squeeze.ok) {
    errors.push(`short_squeeze: ${squeeze.error}`);
    eventBus.emit(EVENT_TYPES.ENGINE_FAILURE, {
      source: 'short_squeeze_pipeline',
      issue: 'engine_failure',
      severity: 'high',
      error: squeeze.error,
      timestamp: new Date().toISOString(),
    });
  } else {
    eventBus.emit(EVENT_TYPES.SHORT_SQUEEZE, {
      source: 'short_squeeze_pipeline',
      count: Number(squeeze.result?.inserted || 0),
      timestamp: new Date().toISOString(),
    });
  }

  if (!opportunity.ok) {
    errors.push(`opportunity: ${opportunity.error}`);
    eventBus.emit(EVENT_TYPES.ENGINE_FAILURE, {
      source: 'opportunity_ranker_pipeline',
      issue: 'engine_failure',
      severity: 'high',
      error: opportunity.error,
      timestamp: new Date().toISOString(),
    });
  }

  if (!narrative.ok) {
    errors.push(`market_narrative: ${narrative.error}`);
    eventBus.emit(EVENT_TYPES.ENGINE_FAILURE, {
      source: 'market_narrative_pipeline',
      issue: 'engine_failure',
      severity: 'high',
      error: narrative.error,
      timestamp: new Date().toISOString(),
    });
  }

  latestPipelineRun = {
    status: errors.length ? 'warning' : 'ok',
    last_run: new Date().toISOString(),
    execution_time_ms: Date.now() - startedAt,
    stages,
    validation,
    errors,
  };

  logger.info('[INTELLIGENCE_PIPELINE] run complete', {
    status: latestPipelineRun.status,
    execution_time_ms: latestPipelineRun.execution_time_ms,
    errors: latestPipelineRun.errors,
  });

  eventBus.emit(EVENT_TYPES.PRICE_UPDATE, {
    source: 'intelligence_pipeline',
    issue: 'pipeline_run_completed',
    status: latestPipelineRun.status,
    execution_time_ms: latestPipelineRun.execution_time_ms,
    timestamp: new Date().toISOString(),
  });

  await updateTelemetry('pipeline_runtime', {
    status: latestPipelineRun.status,
    runtime_ms: latestPipelineRun.execution_time_ms,
    errors: latestPipelineRun.errors,
    validation,
    stages: {
      flow: flow.execution_time_ms,
      squeeze: squeeze.execution_time_ms,
      opportunity: opportunity.execution_time_ms,
      narrative: narrative.execution_time_ms,
    },
    at: latestPipelineRun.last_run,
  });

  return latestPipelineRun;
}

function getIntelligencePipelineHealth() {
  return latestPipelineRun;
}

function startIntelligencePipelineScheduler() {
  readyAt = Date.now() + startupDelayMs;

  if (startupDelayMs > 0) {
    logger.info('[INTELLIGENCE_PIPELINE] startup run delayed', {
      startup_delay_ms: startupDelayMs,
    });
    setTimeout(() => {
      void runIntelligencePipeline().catch((error) => {
        logger.warn('[INTELLIGENCE_PIPELINE] startup run failed', { error: error.message });
      });
    }, startupDelayMs);
  } else {
    void runIntelligencePipeline().catch((error) => {
      logger.warn('[INTELLIGENCE_PIPELINE] startup run failed', { error: error.message });
    });
  }

  cron.schedule('*/1 * * * *', async () => {
    if (readyAt > Date.now()) {
      logger.info('[INTELLIGENCE_PIPELINE] cron run skipped during startup warmup', {
        ready_in_ms: readyAt - Date.now(),
      });
      return;
    }
    await runIntelligencePipeline();
  });
  logger.info('[INTELLIGENCE_PIPELINE] scheduler started', { every_seconds: 60 });
}

module.exports = {
  runIntelligencePipeline,
  getIntelligencePipelineHealth,
  startIntelligencePipelineScheduler,
};
