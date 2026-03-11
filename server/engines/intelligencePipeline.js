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
const eventBus = require('../events/eventBus');
const EVENT_TYPES = require('../events/eventTypes');

let latestPipelineRun = {
  status: 'idle',
  last_run: null,
  execution_time_ms: 0,
  stages: {},
  errors: [],
};

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

  const flow = await runIsolated('flow_detection_pipeline', runFlowDetectionEngine);
  stages.flow_detection = flow;
  if (!flow.ok) {
    errors.push(`flow_detection: ${flow.error}`);
    eventBus.emit(EVENT_TYPES.ENGINE_FAILURE, {
      source: 'flow_detection_pipeline',
      issue: 'engine_failure',
      severity: 'high',
      error: flow.error,
      timestamp: new Date().toISOString(),
    });
  }
  if (flow.ok) {
    eventBus.emit(EVENT_TYPES.FLOW_DETECTED, {
      source: 'flow_detection_pipeline',
      count: Number(flow.result?.inserted || 0),
      timestamp: new Date().toISOString(),
    });
  }

  const squeeze = await runIsolated('short_squeeze_pipeline', runShortSqueezeEngine);
  stages.short_squeeze = squeeze;
  if (!squeeze.ok) {
    errors.push(`short_squeeze: ${squeeze.error}`);
    eventBus.emit(EVENT_TYPES.ENGINE_FAILURE, {
      source: 'short_squeeze_pipeline',
      issue: 'engine_failure',
      severity: 'high',
      error: squeeze.error,
      timestamp: new Date().toISOString(),
    });
  }
  if (squeeze.ok) {
    eventBus.emit(EVENT_TYPES.SHORT_SQUEEZE, {
      source: 'short_squeeze_pipeline',
      count: Number(squeeze.result?.inserted || 0),
      timestamp: new Date().toISOString(),
    });
  }

  const opportunity = await runIsolated('opportunity_ranker_pipeline', runOpportunityRanker);
  stages.opportunity = opportunity;
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

  const narrative = await runIsolated('market_narrative_pipeline', runMarketNarrativeEngine);
  stages.market_narrative = narrative;
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

  return latestPipelineRun;
}

function getIntelligencePipelineHealth() {
  return latestPipelineRun;
}

function startIntelligencePipelineScheduler() {
  cron.schedule('*/1 * * * *', async () => {
    await runIntelligencePipeline();
  });
  logger.info('[INTELLIGENCE_PIPELINE] scheduler started', { every_seconds: 60 });
}

module.exports = {
  runIntelligencePipeline,
  getIntelligencePipelineHealth,
  startIntelligencePipelineScheduler,
};
