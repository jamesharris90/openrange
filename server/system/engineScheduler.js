const cron = require('node-cron');
const pLimit = require('p-limit').default;
const logger = require('../logger');
const { updateTelemetry } = require('../cache/telemetryCache');
const { ingestMarketQuotesRefresh } = require('../engines/fmpMarketIngestion');
const { runDataIntegrityEngine } = require('../engines/dataIntegrityEngine');
const { runFlowDetectionEngine } = require('../engines/flowDetectionEngine');
const { runShortSqueezeEngine } = require('../engines/shortSqueezeEngine');
const { runOpportunityRanker } = require('../engines/opportunityRanker');
const { runProviderHealthCheck } = require('../engines/providerHealthEngine');
const { refreshSparklineCache } = require('../cache/sparklineCacheEngine');
const { refreshTickerCache } = require('../cache/tickerCache');

const limit = pLimit(2);

const schedulerState = {
  status: 'idle',
  started_at: null,
  last_runs: {},
};

async function runWithTelemetry(name, fn, telemetryKey) {
  const startedAt = Date.now();
  try {
    const result = await limit(fn);
    const runtime = Date.now() - startedAt;
    schedulerState.last_runs[name] = { status: 'ok', runtime_ms: runtime, at: new Date().toISOString() };
    await updateTelemetry(telemetryKey, {
      status: 'ok',
      runtime_ms: runtime,
      at: new Date().toISOString(),
      result_summary: result?.ok === false ? 'warning' : 'ok',
    });
    return result;
  } catch (error) {
    const runtime = Date.now() - startedAt;
    schedulerState.last_runs[name] = { status: 'failed', runtime_ms: runtime, at: new Date().toISOString(), error: error.message };
    await updateTelemetry(telemetryKey, {
      status: 'failed',
      runtime_ms: runtime,
      at: new Date().toISOString(),
      error: error.message,
    });
    logger.error('[ENGINE_SCHEDULER] run failed', { name, error: error.message });
    return { ok: false, error: error.message };
  }
}

function startEngineScheduler() {
  if (schedulerState.status === 'running') return;

  schedulerState.status = 'running';
  schedulerState.started_at = new Date().toISOString();

  cron.schedule('*/30 * * * * *', () => {
    runWithTelemetry('ingestionEngine', ingestMarketQuotesRefresh, 'ingestion_runtime');
  });

  cron.schedule('*/30 * * * * *', () => {
    runWithTelemetry('integrityEngine', runDataIntegrityEngine, 'integrity_runtime');
  });

  cron.schedule('*/20 * * * * *', () => {
    runWithTelemetry('flowDetectionEngine', runFlowDetectionEngine, 'flow_runtime');
  });

  cron.schedule('*/30 * * * * *', () => {
    runWithTelemetry('shortSqueezeEngine', runShortSqueezeEngine, 'squeeze_runtime');
  });

  cron.schedule('*/20 * * * * *', () => {
    runWithTelemetry('opportunityEngine', runOpportunityRanker, 'opportunity_runtime');
  });

  cron.schedule('*/60 * * * * *', async () => {
    const result = await runWithTelemetry('providerHealthEngine', runProviderHealthCheck, 'provider_health');
    await updateTelemetry('provider_health', {
      status: 'ok',
      providers: result?.providers || {},
      checked_at: result?.checked_at || new Date().toISOString(),
    });
  });

  cron.schedule('*/30 * * * * *', () => {
    runWithTelemetry('sparklineCacheEngine', refreshSparklineCache, 'sparkline_runtime');
  });

  cron.schedule('*/20 * * * * *', () => {
    runWithTelemetry('tickerCacheEngine', refreshTickerCache, 'ticker_runtime');
  });

  logger.info('[ENGINE_SCHEDULER] started');
}

function getEngineSchedulerHealth() {
  return schedulerState;
}

module.exports = {
  startEngineScheduler,
  getEngineSchedulerHealth,
};
