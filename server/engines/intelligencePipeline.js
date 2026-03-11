const cron = require('node-cron');
const logger = require('../logger');
const { runStocksInPlayEngine } = require('./stocksInPlayEngine');
const { runShortSqueezeEngine } = require('./shortSqueezeEngine');
const { runFlowDetectionEngine } = require('./flowDetectionEngine');
const { runOpportunityRanker } = require('./opportunityRanker');
const { runMarketNarrativeEngine } = require('./marketNarrativeEngine');
const { runIsolated } = require('./engineErrorIsolation');

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

  const stocks = await runIsolated('stocks_in_play_pipeline', runStocksInPlayEngine);
  stages.stocks_in_play = stocks;
  if (!stocks.ok) errors.push(`stocks_in_play: ${stocks.error}`);

  const [squeeze, flow] = await Promise.all([
    runIsolated('short_squeeze_pipeline', runShortSqueezeEngine),
    runIsolated('flow_detection_pipeline', runFlowDetectionEngine),
  ]);
  stages.short_squeeze = squeeze;
  stages.flow_detection = flow;
  if (!squeeze.ok) errors.push(`short_squeeze: ${squeeze.error}`);
  if (!flow.ok) errors.push(`flow_detection: ${flow.error}`);

  const opportunity = await runIsolated('opportunity_ranker_pipeline', runOpportunityRanker);
  stages.opportunity = opportunity;
  if (!opportunity.ok) errors.push(`opportunity: ${opportunity.error}`);

  const narrative = await runIsolated('market_narrative_pipeline', runMarketNarrativeEngine);
  stages.market_narrative = narrative;
  if (!narrative.ok) errors.push(`market_narrative: ${narrative.error}`);

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
