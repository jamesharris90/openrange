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
const { recordEngineTelemetry, logSystemAlert, normalizeRowsProcessed } = require('./engineOps');

const limit = pLimit(2);

const schedulerState = {
  status: 'idle',
  started_at: null,
  last_runs: {},
};

async function runWithTelemetry(name, fn, telemetryKey) {
  const startedAt = Date.now();

  const rowsProcessedFromResult = (result) => {
    if (Number.isFinite(Number(result))) return Number(result);
    if (!result || typeof result !== 'object') return 0;

    const candidates = [
      result.rows_processed,
      result.rowsProcessed,
      result.inserted,
      result.count,
      result.total,
      result.rowCount,
    ];

    const first = candidates.find((value) => Number.isFinite(Number(value)));
    return Number.isFinite(Number(first)) ? Number(first) : 0;
  };

  try {
    const result = await limit(fn);
    const runtime = Date.now() - startedAt;
    const rowsProcessed = normalizeRowsProcessed(rowsProcessedFromResult(result));

    schedulerState.last_runs[name] = { status: 'ok', runtime_ms: runtime, at: new Date().toISOString() };

    await updateTelemetry(telemetryKey, {
      status: 'ok',
      runtime_ms: runtime,
      rows_processed: rowsProcessed,
      at: new Date().toISOString(),
      result_summary: result?.ok === false ? 'warning' : 'ok',
    });

    await recordEngineTelemetry({
      engineName: name,
      status: result?.ok === false ? 'warning' : 'ok',
      rowsProcessed,
      runtimeMs: runtime,
      details: {
        telemetry_key: telemetryKey,
      },
    });

    return result;
  } catch (error) {
    const runtime = Date.now() - startedAt;

    schedulerState.last_runs[name] = { status: 'failed', runtime_ms: runtime, at: new Date().toISOString(), error: error.message };

    await updateTelemetry(telemetryKey, {
      status: 'failed',
      runtime_ms: runtime,
      rows_processed: 0,
      at: new Date().toISOString(),
      error: error.message,
    });

    await recordEngineTelemetry({
      engineName: name,
      status: 'failed',
      rowsProcessed: 0,
      runtimeMs: runtime,
      details: {
        telemetry_key: telemetryKey,
        error: error.message,
      },
    });

    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: name,
      severity: 'high',
      message: `${name} failed: ${error.message}`,
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
