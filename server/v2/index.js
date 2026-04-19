const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const screenerRoute = require('./routes/screener');
const opportunitiesRoute = require('./routes/opportunities');
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
const legacyEarningsRoute = require('../routes/earnings');
const intelligenceRoute = require('../routes/intelligence');
const adminCoverageRoute = require('../routes/adminCoverage');
const researchRoute = require('../routes/research');
const truthAuditRoute = require('../routes/truthAudit');
const userRoutes = require('../users/routes');
const { buildChartPayload } = require('./services/chartService');
const {
  startNewsSnapshotScheduler,
  startEarningsSnapshotScheduler,
} = require('./services/experienceSnapshotService');
const { buildAndStoreScreenerSnapshot } = require('./services/snapshotService');
const { runYahooNewsIngest } = require('./ingestion/yahooNewsIngest');
const { runNewsBackfill } = require('./ingestion/newsBackfill');
const { startIngestionScheduler, getIngestionSchedulerState } = require('../ingestion/scheduler');
const { startIntelligencePipelineScheduler } = require('../engines/intelligencePipeline');
const { startBacktestScheduler, getBacktestSchedulerState } = require('../services/backtestScheduler');
const { startTradeOutcomeScheduler, getTradeOutcomeSchedulerState } = require('../services/tradeOutcomeScheduler');
const { getDataHealth } = require('../system/dataHealthEngine');
const { startDataHealthMonitor } = require('../system/dataHealthMonitor');
const { startRetentionJobs } = require('../system/retentionJobs');
const { getDataIntegrityHealth } = require('../engines/dataIntegrityEngine');
const { getTelemetry } = require('../cache/telemetryCache');
const { registerEmailIntelligenceSchedules } = require('../email/emailDispatcher');

let yahooSchedulerStarted = false;
let newsBackfillSchedulerStarted = false;
let screenerSnapshotSchedulerStarted = false;
let intelligencePipelineSchedulerStarted = false;
let snapshotRunning = false;

const chartRoute = express.Router();
const chartV5Route = express.Router();

chartRoute.get('/:symbol', async (req, res) => {
  try {
    const payload = await buildChartPayload(req.params.symbol, req.query.interval || req.query.timeframe);
    return res.json(payload);
  } catch (error) {
    const message = error?.message || 'chart_fetch_failed';
    const status = message === 'symbol_required' ? 400 : message === 'chart_data_unavailable' ? 404 : 502;

    return res.status(status).json({
      success: false,
      candles: [],
      timeframe: null,
      source: 'unavailable',
      error: message,
    });
  }
});

chartV5Route.get('/chart', async (req, res) => {
  try {
    const payload = await buildChartPayload(req.query.symbol, req.query.interval || req.query.timeframe);
    return res.json(payload);
  } catch (error) {
    const message = error?.message || 'chart_fetch_failed';
    const status = message === 'symbol_required' ? 400 : message === 'chart_data_unavailable' ? 404 : 502;

    return res.status(status).json({
      success: false,
      candles: [],
      timeframe: null,
      source: 'unavailable',
      error: message,
    });
  }
});

const isRailwayRuntime = Boolean(
  process.env.RAILWAY_PROJECT_ID
  || process.env.RAILWAY_ENVIRONMENT_ID
  || process.env.RAILWAY_SERVICE_ID
);
const railwayServiceRole = String(process.env.OPENRANGE_SERVICE_ROLE || '').trim().toLowerCase();
const screenerSnapshotStartupDelayMs = Number(process.env.SCREENER_SNAPSHOT_STARTUP_DELAY_MS || 0);
let screenerSnapshotReadyAt = 0;

const STARTUP_DELAYS_MS = {
  screenerSnapshot: Number(process.env.STARTUP_DELAY_SCREENER_SNAPSHOT_MS || 10_000),
  newsSnapshot: Number(process.env.STARTUP_DELAY_NEWS_SNAPSHOT_MS || 20_000),
  earningsSnapshot: Number(process.env.STARTUP_DELAY_EARNINGS_SNAPSHOT_MS || 30_000),
  researchWarmup: Number(process.env.STARTUP_DELAY_RESEARCH_WARMUP_MS || 40_000),
  ingestion: Number(process.env.STARTUP_DELAY_INGESTION_MS || 50_000),
  backgroundServices: Number(process.env.STARTUP_DELAY_BACKGROUND_SERVICES_MS || 60_000),
  nonEssential: Number(process.env.STARTUP_DELAY_NON_ESSENTIAL_MS || 70_000),
};
const HEALTH_TIMEOUTS_MS = {
  dataHealth: Number(process.env.HEALTH_DATA_TIMEOUT_MS || 4000),
  telemetry: Number(process.env.HEALTH_TELEMETRY_TIMEOUT_MS || 1000),
};

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
  const safeModeEnabled = envFlag('SAFE_MODE', false);
  const railwayMainServiceEnabled = railwayServiceRole !== 'coverage-worker' && railwayServiceRole !== 'phase2-worker';
  const backgroundServicesDefault = isRailwayRuntime ? false : true;
  const backgroundServicesEnabled = envFlag('ENABLE_BACKGROUND_SERVICES', backgroundServicesDefault) && !safeModeEnabled;
  const nonEssentialDefault = isRailwayRuntime ? false : true;
  const screenerSnapshotDefault = isRailwayRuntime ? railwayMainServiceEnabled : true;
  const railwayIngestionRoleEnabled = railwayMainServiceEnabled;
  const ingestionSchedulerDefault = isRailwayRuntime
    ? railwayIngestionRoleEnabled
    : backgroundServicesEnabled;
  const ingestionSchedulerEnabled = envFlag('ENABLE_INGESTION_SCHEDULER', ingestionSchedulerDefault) && !safeModeEnabled;
  const nonEssentialEnginesEnabled = backgroundServicesEnabled && envFlag('ENABLE_NON_ESSENTIAL_ENGINES', nonEssentialDefault);
  const screenerSnapshotEnabled = envFlag('ENABLE_SCREENER_SNAPSHOT_SCHEDULER', screenerSnapshotDefault) && !safeModeEnabled;

  return {
    ingestionSchedulerEnabled,
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

async function runStartupTask(name, task) {
  try {
    await task();
    console.log('[STARTUP] task complete', { name });
  } catch (error) {
    console.warn('[STARTUP] task failed', {
      name,
      error: error.message,
    });
  }
}

function scheduleStartupTask(name, delayMs, task) {
  console.log('[STARTUP] task scheduled', { name, delayMs });

  const timer = setTimeout(() => {
    void runStartupTask(name, task);
  }, Math.max(0, Number(delayMs) || 0));

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

function withDeadline(name, promiseFactory, timeoutMs, fallbackValue) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      console.warn('[HEALTH] diagnostic timed out', { name, timeoutMs });
      resolve(fallbackValue);
    }, timeoutMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    Promise.resolve()
      .then(promiseFactory)
      .then((value) => {
        if (settled) {
          return;
        }

        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) {
          return;
        }

        clearTimeout(timer);
        resolve(fallbackValue);
      });
  });
}

function createV2App() {
  const app = express();
  const schedulerFlags = resolveSchedulerFlags();

  app.use(cors());
  app.use(express.json());
  app.locals.schedulerFlags = schedulerFlags;

  console.log('🚫 LEGACY SYSTEM DISABLED — V2 MODE ACTIVE');
  console.log('[SCHEDULERS] runtime flags', schedulerFlags);

  app.get('/api/health', async (_req, res) => {
    const integrity = getDataIntegrityHealth();
    const data_integrity_engine = resolveIntegrityStatus(integrity);

    const [dataHealth, telemetry] = await Promise.all([
      withDeadline(
        'data_health',
        () => getDataHealth().catch((error) => ({ status: 'warning', error: error.message, tables: {} })),
        HEALTH_TIMEOUTS_MS.dataHealth,
        {
          status: 'warning',
          error: 'timeout',
          timeout: true,
          tables: {},
        }
      ),
      withDeadline(
        'telemetry',
        () => getTelemetry().catch(() => ({})),
        HEALTH_TIMEOUTS_MS.telemetry,
        {
          timeout: true,
          last_update: null,
          integrity_runtime: null,
        }
      ),
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
  app.use('/api/admin', adminCoverageRoute);
  app.use('/api/dashboard', dashboardRoute);
  app.use('/api/users', userRoutes);
  app.use('/', newsletterRoute);
  app.use('/api/dev', devRoute);

  return app;
}

function startV2BackgroundServices(app, options = {}) {
  const schedulerFlags = options.schedulerFlags || app?.locals?.schedulerFlags || resolveSchedulerFlags();
  const hooks = {
    startResearchWarmup: options.startResearchWarmup,
  };

  console.log('[STARTUP] staging background services', {
    delays_ms: STARTUP_DELAYS_MS,
    schedulerFlags,
  });

  if (schedulerFlags.screenerSnapshotEnabled) {
    scheduleStartupTask('screener_snapshot_scheduler', STARTUP_DELAYS_MS.screenerSnapshot, async () => {
      ensureScreenerSnapshotScheduler();
    });
  } else {
    console.log('[SCHEDULERS] screener snapshot scheduler disabled');
  }

  scheduleStartupTask('news_snapshot_scheduler', STARTUP_DELAYS_MS.newsSnapshot, async () => {
    startNewsSnapshotScheduler();
  });

  scheduleStartupTask('earnings_snapshot_scheduler', STARTUP_DELAYS_MS.earningsSnapshot, async () => {
    startEarningsSnapshotScheduler();
  });

  if (typeof hooks.startResearchWarmup === 'function') {
    scheduleStartupTask('research_warmup', STARTUP_DELAYS_MS.researchWarmup, hooks.startResearchWarmup);
  }

  if (schedulerFlags.ingestionSchedulerEnabled) {
    scheduleStartupTask('ingestion_scheduler', STARTUP_DELAYS_MS.ingestion, async () => {
      startIngestionScheduler();
      startRetentionJobs();
    });
  } else {
    console.log('[SCHEDULERS] ingestion scheduler disabled');
  }

  if (schedulerFlags.backgroundServicesEnabled) {
    scheduleStartupTask('background_services', STARTUP_DELAYS_MS.backgroundServices, async () => {
      startBacktestScheduler();
      startTradeOutcomeScheduler();
      startDataHealthMonitor();
    });
  } else {
    console.log('[SCHEDULERS] background services disabled');
  }

  if (schedulerFlags.nonEssentialEnginesEnabled) {
    scheduleStartupTask('non_essential_schedulers', STARTUP_DELAYS_MS.nonEssential, async () => {
      ensureYahooNewsScheduler();
      ensureNewsBackfillScheduler();
      ensureIntelligencePipelineScheduler();
      registerEmailIntelligenceSchedules();
    });
  } else {
    console.log('[SCHEDULERS] non-essential schedulers disabled');
  }
}

module.exports = {
  createV2App,
  startV2BackgroundServices,
};