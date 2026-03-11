const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { ingestMarketQuotesRefresh, ingestMarketQuotesBootstrap } = require('../engines/fmpMarketIngestion');
const { runMarketNarrativeEngine } = require('../engines/marketNarrativeEngine');
const runRadarEngine = require('../engines/radarEngine');
const { runOpportunityRanker } = require('../engines/opportunityRanker');
const { runStocksInPlayEngine } = require('../engines/stocksInPlayEngine');
const { runShortSqueezeEngine } = require('../engines/shortSqueezeEngine');
const { runFlowDetectionEngine } = require('../engines/flowDetectionEngine');
const { getDataHealth } = require('./dataHealthEngine');
const { runIntelligencePipeline } = require('../engines/intelligencePipeline');
const { runProviderHealthCheck } = require('../engines/providerHealthEngine');
const { refreshSparklineCache, getSparklineCacheStats } = require('../cache/sparklineCacheEngine');
const { refreshTickerCache, getTickerTapeCache } = require('../cache/tickerCache');
const { getTelemetry } = require('../cache/telemetryCache');
const { queryWithTimeout } = require('../db/pg');
const { runDataIntegrityEngine, getDataIntegrityHealth } = require('../engines/dataIntegrityEngine');
const { runProviderCrossCheckEngine } = require('../engines/providerCrossCheckEngine');
const { initEventLogger, getEventBusHealth } = require('../events/eventLogger');
const { startSystemAlertEngine, getSystemAlertEngineHealth } = require('../engines/systemAlertEngine');
const { startEngineScheduler, getEngineSchedulerHealth } = require('./engineScheduler');
const eventBus = require('../events/eventBus');
const logger = require('../logger');

function line(label, status, detail = '') {
  return `${label}: ${status}${detail ? ` (${detail})` : ''}`;
}

async function runEngineDiagnostics(options = {}) {
  const ensureScheduler = Boolean(options.ensureScheduler);
  initEventLogger(eventBus);
  startSystemAlertEngine();
  if (ensureScheduler) {
    startEngineScheduler();
  }

  const results = [];
  const engineStatus = {};

  const runStep = async (key, label, fn) => {
    const startedAt = Date.now();
    try {
      const output = await fn();
      const ok = output?.ok !== false && !output?.error;
      engineStatus[key] = {
        status: ok ? 'ok' : 'failed',
        errors: ok ? [] : [String(output?.error || 'Unknown failure')],
        last_run: new Date().toISOString(),
        execution_time: Date.now() - startedAt,
      };
      results.push(line(label, ok ? 'OK' : 'FAILED', ok ? '' : String(output?.error || 'Unknown failure')));
    } catch (error) {
      logger.error('[ENGINE ERROR] diagnostics step failed', { engine: key, error: error.message });
      engineStatus[key] = {
        status: 'failed',
        errors: [String(error.message || 'Unknown failure')],
        last_run: new Date().toISOString(),
        execution_time: Date.now() - startedAt,
      };
      results.push(line(label, 'FAILED', error.message));
    }
  };

  await runStep('ingestion', 'INGESTION ENGINE', async () => {
    const refreshResult = await ingestMarketQuotesRefresh();
    if (refreshResult?.error) return { ok: false, error: refreshResult.error };
    return { ok: true };
  });

  await runStep('narrative', 'NARRATIVE ENGINE', runMarketNarrativeEngine);
  await runStep('radar', 'RADAR ENGINE', runRadarEngine);
  await runStep('opportunity', 'OPPORTUNITY ENGINE', runOpportunityRanker);
  await runStep('stocks_in_play', 'STOCKS IN PLAY ENGINE', runStocksInPlayEngine);
  await runStep('short_squeeze', 'SHORT SQUEEZE ENGINE', runShortSqueezeEngine);
  await runStep('flow_detection', 'FLOW DETECTION ENGINE', runFlowDetectionEngine);
  await runStep('market_narrative', 'MARKET NARRATIVE ENGINE', runMarketNarrativeEngine);
  await runStep('pipeline', 'PIPELINE ENGINE', runIntelligencePipeline);
  await runStep('integrity', 'DATA INTEGRITY', runDataIntegrityEngine);
  await runStep('crosscheck', 'CROSSCHECK ENGINE', runProviderCrossCheckEngine);

  const health = await getDataHealth();
  if (Number(health.tables?.earnings_events || 0) === 0) {
    engineStatus.earnings = {
      status: 'warning',
      errors: ['0 rows'],
      last_run: new Date().toISOString(),
      execution_time: 0,
    };
    results.push(line('EARNINGS ENGINE', 'WARNING', '0 rows'));
  } else {
    engineStatus.earnings = {
      status: 'ok',
      errors: [],
      last_run: new Date().toISOString(),
      execution_time: 0,
    };
    results.push(line('EARNINGS ENGINE', 'OK'));
  }

  const providerHealth = await runProviderHealthCheck();
  const providerNodes = Object.values(providerHealth?.providers || {});
  const providersOk = providerNodes.length > 0 && providerNodes.every((p) => p.status === 'ok');
  results.push(line('PROVIDERS', providersOk ? 'OK' : 'WARN'));

  const eventBusHealth = getEventBusHealth();
  const eventBusOk = Boolean(eventBusHealth?.logger_initialized);
  results.push(line('EVENT BUS', eventBusOk ? 'OK' : 'WARN'));

  const integrityHealth = getDataIntegrityHealth();
  const integrityOk = ['ok', 'warning'].includes(String(integrityHealth?.status || '').toLowerCase());
  results.push(line('INTEGRITY ENGINE', integrityOk ? 'OK' : 'WARN'));

  const alertEngineHealth = getSystemAlertEngineHealth();
  const alertOk = Boolean(alertEngineHealth?.initialized);
  results.push(line('ALERT SYSTEM', alertOk ? 'OK' : 'WARN'));

  const schedulerHealth = getEngineSchedulerHealth();
  const schedulerOk = schedulerHealth?.status === 'running';
  results.push(line('SCHEDULER', schedulerOk ? 'OK' : 'WARN'));

  await refreshTickerCache();
  await refreshSparklineCache();
  const tickerState = await getTickerTapeCache();
  const sparklineStats = await getSparklineCacheStats();
  const cacheOk = tickerState?.status === 'ok' && Number(sparklineStats?.rows || 0) >= 0;
  results.push(line('CACHE', cacheOk ? 'OK' : 'WARN'));

  const telemetry = await getTelemetry();
  const eventStats = await queryWithTimeout(
    `SELECT COUNT(*)::int AS events_last_min
     FROM system_events
     WHERE created_at > NOW() - interval '60 seconds'`,
    [],
    { timeoutMs: 2500, label: 'diagnostics.events_per_second', maxRetries: 0 }
  ).catch(() => ({ rows: [{ events_last_min: 0 }] }));

  const eventsLastMin = Number(eventStats.rows?.[0]?.events_last_min || 0);
  const queueDepth = Number((telemetry?.queue_depth || 0));
  const cacheHits = Number(telemetry?.cache_hits || 0);
  const cacheMisses = Number(telemetry?.cache_misses || 0);
  const cacheHitRate = cacheHits + cacheMisses > 0
    ? Number((cacheHits / (cacheHits + cacheMisses)).toFixed(4))
    : 0;

  const perfMetrics = {
    event_bus_throughput: eventsLastMin,
    events_per_second: Number((eventsLastMin / 60).toFixed(4)),
    queue_depth: queueDepth,
    avg_engine_runtime: Number(telemetry?.avg_engine_runtime || 0),
    cache_hit_rate: cacheHitRate,
  };

  const allOk = Object.values(engineStatus).every((item) => item.status === 'ok') && providersOk && cacheOk && eventBusOk && integrityOk && alertOk && schedulerOk;
  results.unshift(line('SYSTEM STATUS', allOk ? 'OK' : 'WARN'));
  results.push(line('ALL ENGINES', allOk ? 'OK' : 'WARN'));

  return {
    lines: results,
    health,
    provider_health: providerHealth,
    event_bus_health: eventBusHealth,
    integrity_health: integrityHealth,
    alert_engine_health: alertEngineHealth,
    scheduler_health: schedulerHealth,
    performance_telemetry: perfMetrics,
    cache_health: {
      ticker_cache: tickerState?.status || 'unknown',
      ticker_cache_rows: (tickerState?.rows || []).length,
      sparkline_cache_rows: Number(sparklineStats?.rows || 0),
      cache_refresh_time: tickerState?.updated_at || sparklineStats?.updated_at || null,
    },
    engines: engineStatus,
    status: allOk ? 'ok' : 'warning',
    checked_at: new Date().toISOString(),
  };
}

async function runAsScript() {
  const output = await runEngineDiagnostics({ ensureScheduler: true });
  console.log(output.lines.join('\n'));
  process.exit(0);
}

if (require.main === module) {
  runAsScript().catch((error) => {
    logger.error('[ENGINE ERROR] diagnostics script failed', { error: error.message });
    console.error(line('ENGINE DIAGNOSTICS', 'FAILED', error.message));
    process.exit(1);
  });
}

module.exports = {
  runEngineDiagnostics,
};
