const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const screenerRoute = require('./routes/screener');
const opportunitiesRoute = require('./routes/opportunities');
const chartRoute = require('./routes/chart');
const legacyResearchRoute = require('./routes/research');
const newsRoute = require('./routes/news');
const earningsV2Route = require('./routes/earnings');
const systemRoute = require('./routes/system');
const validationRoute = require('./routes/validation');
const adminRoute = require('./routes/admin');
const devRoute = require('./routes/dev');
const dashboardRoute = require('../routes/dashboard');
const newsletterRoute = require('../routes/newsletter');
const marketRoute = require('../routes/market');
const chartV5Route = require('../routes/chartV2.ts');
const legacyEarningsRoute = require('../routes/earnings');
const intelligenceRoute = require('../routes/intelligence');
const researchRoute = require('../routes/research');
const truthAuditRoute = require('../routes/truthAudit');
const { buildAndStoreScreenerSnapshot } = require('./services/snapshotService');
const { runYahooNewsIngest } = require('./ingestion/yahooNewsIngest');
const { runNewsBackfill } = require('./ingestion/newsBackfill');
const { startIngestionScheduler, getIngestionSchedulerState } = require('../ingestion/scheduler');
const { startIntelligencePipelineScheduler } = require('../engines/intelligencePipeline');
const { startBacktestScheduler, getBacktestSchedulerState } = require('../services/backtestScheduler');
const { startTradeOutcomeScheduler, getTradeOutcomeSchedulerState } = require('../services/tradeOutcomeScheduler');
const { getDataHealth } = require('../system/dataHealthEngine');
const { startDataHealthMonitor } = require('../system/dataHealthMonitor');
const { getDataIntegrityHealth } = require('../engines/dataIntegrityEngine');
const { getTelemetry } = require('../cache/telemetryCache');
const { registerEmailIntelligenceSchedules } = require('../email/emailDispatcher');

let yahooSchedulerStarted = false;
let newsBackfillSchedulerStarted = false;
let screenerSnapshotSchedulerStarted = false;
let intelligencePipelineSchedulerStarted = false;
let snapshotRunning = false;
const isRailwayRuntime = Boolean(
  process.env.RAILWAY_PROJECT_ID
  || process.env.RAILWAY_ENVIRONMENT_ID
  || process.env.RAILWAY_SERVICE_ID
);
const screenerSnapshotStartupDelayMs = Number(process.env.SCREENER_SNAPSHOT_STARTUP_DELAY_MS || (isRailwayRuntime ? 120000 : 0));
let screenerSnapshotReadyAt = 0;

function envFlag(name, defaultValue = true) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function resolveSchedulerFlags() {
  const backgroundServicesDefault = isRailwayRuntime ? false : true;
  const backgroundServicesEnabled = envFlag('ENABLE_BACKGROUND_SERVICES', backgroundServicesDefault) && !envFlag('SAFE_MODE', false);
  const nonEssentialDefault = isRailwayRuntime ? false : true;
  const screenerSnapshotDefault = isRailwayRuntime ? false : true;
  const nonEssentialEnginesEnabled = backgroundServicesEnabled && envFlag('ENABLE_NON_ESSENTIAL_ENGINES', nonEssentialDefault);
  const screenerSnapshotEnabled = backgroundServicesEnabled && envFlag('ENABLE_SCREENER_SNAPSHOT_SCHEDULER', screenerSnapshotDefault);

  return {
    backgroundServicesEnabled,
    nonEssentialEnginesEnabled,
    screenerSnapshotEnabled,
  };
}

function resolveAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveIntegrityStatus(health) {
  const status = String(health?.status || 'idle').toLowerCase();
  const persistenceStatus = String(health?.persistence?.status || 'ok').toLowerCase();
  return status === 'failed' || persistenceStatus === 'degraded' ? 'degraded' : 'ok';
}

function summarizeIntegrityHealth(health) {
  return {
    status: health?.status || 'idle',
    last_run: health?.last_run || null,
    execution_time_ms: Number(health?.execution_time_ms || 0),
    issue_count: Array.isArray(health?.issues) ? health.issues.length : 0,
    persistence: health?.persistence || {
      status: 'ok',
      persisted_issue_count: 0,
      dropped_issue_count: 0,
      last_error: null,
    },
  };
}

function ensureYahooNewsScheduler() {
  if (yahooSchedulerStarted) {
    return;
  }

  yahooSchedulerStarted = true;
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runYahooNewsIngest();
    } catch (error) {
      console.warn('[YAHOO_NEWS_INGEST] scheduled run failed', { error: error.message });
    }
  });

  console.log('[YAHOO_NEWS_INGEST] scheduler active (every 15 minutes)');
}

function ensureNewsBackfillScheduler() {
  if (newsBackfillSchedulerStarted) {
    return;
  }

  newsBackfillSchedulerStarted = true;
  cron.schedule('0 */6 * * *', async () => {
    console.log('[NEWS_BACKFILL] started');
    try {
      await runNewsBackfill();
    } catch (error) {
      console.warn('[NEWS_BACKFILL] scheduled run failed', { error: error.message });
    }
  });

  console.log('[NEWS_BACKFILL] scheduler active (every 6 hours)');
}

async function runSnapshot(trigger) {
  if (snapshotRunning) {
    console.warn('[SCREENER_SNAPSHOT] build skipped because a prior cycle is still running', { trigger });
    return;
  }

  snapshotRunning = true;
  try {
    await buildAndStoreScreenerSnapshot();
  } catch (error) {
    console.error('SNAPSHOT ERROR:', error.message);
  } finally {
    snapshotRunning = false;
  }
}

function ensureScreenerSnapshotScheduler() {
  if (screenerSnapshotSchedulerStarted) {
    return;
  }

  screenerSnapshotSchedulerStarted = true;
  screenerSnapshotReadyAt = Date.now() + screenerSnapshotStartupDelayMs;
  if (screenerSnapshotStartupDelayMs > 0) {
    console.log('[SCREENER_SNAPSHOT] startup run delayed', { delayMs: screenerSnapshotStartupDelayMs });
    setTimeout(() => {
      void runSnapshot('startup');
    }, screenerSnapshotStartupDelayMs);
  } else {
    void runSnapshot('startup');
  }
  cron.schedule('* * * * *', () => {
    if (screenerSnapshotReadyAt > Date.now()) {
      console.log('[SCREENER_SNAPSHOT] interval run skipped during startup warmup', {
        readyInMs: screenerSnapshotReadyAt - Date.now(),
      });
      return;
    }
    void runSnapshot('interval');
  });

  console.log('[SCREENER_SNAPSHOT] scheduler active (every 60 seconds)');
}

function ensureIntelligencePipelineScheduler() {
  if (intelligencePipelineSchedulerStarted) {
    return;
  }

  intelligencePipelineSchedulerStarted = true;
  startIntelligencePipelineScheduler();
}

function createV2App() {
  const app = express();
  const schedulerFlags = resolveSchedulerFlags();

  app.use(cors());
  app.use(express.json());

  console.log('🚫 LEGACY SYSTEM DISABLED — V2 MODE ACTIVE');
  console.log('[SCHEDULERS] runtime flags', schedulerFlags);

  if (schedulerFlags.backgroundServicesEnabled) {
    startIngestionScheduler();
    startBacktestScheduler();
    startTradeOutcomeScheduler();
    startDataHealthMonitor();
  } else {
    console.log('[SCHEDULERS] core ingestion schedulers disabled');
  }

  if (schedulerFlags.nonEssentialEnginesEnabled) {
    ensureYahooNewsScheduler();
    ensureNewsBackfillScheduler();
    ensureIntelligencePipelineScheduler();
    registerEmailIntelligenceSchedules();
  } else {
    console.log('[SCHEDULERS] non-essential schedulers disabled');
  }

  if (schedulerFlags.screenerSnapshotEnabled) {
    ensureScreenerSnapshotScheduler();
  } else {
    console.log('[SCHEDULERS] screener snapshot scheduler disabled');
  }

  app.get('/api/health', async (_req, res) => {
    const integrity = getDataIntegrityHealth();
    const data_integrity_engine = resolveIntegrityStatus(integrity);

    const [dataHealth, telemetry] = await Promise.all([
      getDataHealth().catch((error) => ({ status: 'warning', error: error.message, tables: {} })),
      getTelemetry().catch(() => ({})),
    ]);

    return res.json({
      status: 'ok',
      env: process.env.NODE_ENV || 'development',
      allowedOrigins: resolveAllowedOrigins(),
      data_integrity_engine,
      integrity: summarizeIntegrityHealth(integrity),
      data_health: dataHealth,
      telemetry: {
        last_update: telemetry?.last_update || null,
        integrity_runtime: telemetry?.integrity_runtime || null,
      },
      scheduler_flags: schedulerFlags,
      schedulers: {
        ingestion: getIngestionSchedulerState(),
        backtest: getBacktestSchedulerState(),
        trade_outcomes: getTradeOutcomeSchedulerState(),
      },
      checked_at: new Date().toISOString(),
    });
  });

  app.use('/api/screener', screenerRoute);
  app.use('/api/v2/screener', screenerRoute);
  app.use('/api/opportunities', opportunitiesRoute);
  app.use('/api/v2/opportunities', opportunitiesRoute);
  app.use('/api/v2/chart', chartRoute);
  app.use('/api/v5', chartV5Route);
  app.use('/api/v2/research', legacyResearchRoute);
  app.use('/api/research', researchRoute);
  app.use('/', truthAuditRoute);
  app.use('/', intelligenceRoute);
  app.use('/api/news', newsRoute);
  app.use('/api/v2/news', newsRoute);
  app.use('/api/v2/earnings', earningsV2Route);
  app.use('/', legacyEarningsRoute);
  app.use('/api/market', marketRoute);
  app.use('/api/system', systemRoute);
  app.use('/api/validation', validationRoute);
  app.use('/api/admin', adminRoute);
  app.use('/api/dashboard', dashboardRoute);
  app.use('/', newsletterRoute);
  app.use('/api/dev', devRoute);

  return app;
}

module.exports = {
  createV2App,
};