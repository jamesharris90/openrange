const express = require('express');
const cache = require('../utils/cache');
const usageStore = require('../utils/usageStore');
const market = require('../services/marketDataService');
const db = require('../db');
const { POLYGON_API_KEY, FINVIZ_NEWS_TOKEN, FINNHUB_API_KEY, NODE_ENV } = require('../utils/config');
const { requireAdminAccess } = require('../middleware/requireAdminAccess');
const { getTelemetry } = require('../cache/telemetryCache');
const { getProviderHealth } = require('../engines/providerHealthEngine');
const { getEventBusHealth } = require('../events/eventLogger');
const { getDataIntegrityHealth } = require('../engines/dataIntegrityEngine');
const { getSystemAlertEngineHealth } = require('../engines/systemAlertEngine');
const { getEngineSchedulerHealth } = require('../system/engineScheduler');
const { queryWithTimeout } = require('../db/pg');
const {
  getEmailDispatcherStatus,
  sendImmediateAdminTests,
  sendBeaconMorningBrief,
  sendSystemMonitor,
} = require('../email/emailDispatcher');
const { sendStocksInPlayAlert } = require('../email/stocksInPlayAlert');
const PPLX_API_KEY = process.env.PPLX_API_KEY || null;

const router = express.Router();

async function safeQuery(fn, fallback = null, label = 'admin.query') {
  try {
    return await fn();
  } catch (err) {
    console.error(`[QUERY ERROR] ${label}`, err?.message || err);
    return fallback;
  }
}

async function tableExists(tableName) {
  const result = await safeQuery(
    () => queryWithTimeout(
      'SELECT to_regclass($1) IS NOT NULL AS exists',
      [`public.${tableName}`],
      { timeoutMs: 2500, label: `admin.table_exists.${tableName}`, maxRetries: 0 }
    ),
    { rows: [{ exists: false }] },
    `admin.table_exists.${tableName}`
  );

  return Boolean(result?.rows?.[0]?.exists);
}

async function tableCount(candidates, label) {
  for (const table of candidates) {
    const exists = await safeQuery(
      () => queryWithTimeout(
        'SELECT to_regclass($1) IS NOT NULL AS exists',
        [`public.${table}`],
        { timeoutMs: 2500, label: `${label}.exists`, maxRetries: 0 }
      ),
      { rows: [{ exists: false }] },
      `${label}.exists`
    );

    if (!exists.rows?.[0]?.exists) continue;

    const count = await safeQuery(
      () => queryWithTimeout(
        `SELECT COUNT(*)::int AS count FROM ${table}`,
        [],
        { timeoutMs: 3000, label: `${label}.count`, maxRetries: 0 }
      ),
      { rows: [{ count: 0 }] },
      `${label}.count`
    );

    return Number(count.rows?.[0]?.count || 0);
  }

  return 0;
}

router.get('/api/admin/stats', requireAdminAccess, async (req, res) => {
  const cacheStats = cache.getStats();
  const usage = usageStore.snapshot();
  const usageHour = await db.getUsage({ minutes: 60 });
  const usageDay = await db.getUsage({ minutes: 24 * 60 });
  const mem = process.memoryUsage();
  const providerStatus = {
    active: POLYGON_API_KEY ? 'polygon' : 'yahoo',
    polygonEnabled: !!POLYGON_API_KEY,
    ...market.getProviderStatus(),
    failureHistoryCount: (market.getProviderStatus().failureHistory || []).length,
    lastFailureTs: market.getProviderStatus().lastFailure?.ts || null,
  };
  const currentRpm = usage.rpm;
  const perUserRpm = usage.perUserRpm || {};
  const nearLimit = currentRpm >= 100;
  res.json({
    cache: cacheStats,
    usage,
    persistedUsage: { last60m: usageHour, last24h: usageDay },
    providerStatus,
    featureFlags: {
      polygon: !!POLYGON_API_KEY,
      finvizNews: !!FINVIZ_NEWS_TOKEN,
      finnhubNews: !!FINNHUB_API_KEY,
      aiQuant: !!PPLX_API_KEY,
      env: NODE_ENV,
    },
    limits: {
      generalPerMinute: 120,
      registrationPer15m: 5,
      perUserOverrides: false,
      currentRpm,
      perUserRpm,
      nearLimit,
    },
    system: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      uptime: process.uptime(),
    },
  });
});

router.get('/api/admin/usage', requireAdminAccess, async (req, res) => {
  const windowMinutes = Math.min(parseInt(req.query.minutes, 10) || 60, 24 * 60);
  const usage = await db.getUsage({ minutes: windowMinutes });
  res.json(usage);
});

router.get('/api/admin/users', requireAdminAccess, async (_req, res) => {
  try {
    const hasUsersTable = await tableExists('users');
    if (!hasUsersTable) {
      return res.json({ ok: true, status: 'table_missing', users: [], items: [] });
    }

    const result = await safeQuery(() => queryWithTimeout(
      `SELECT id, username, email, is_admin, is_active, created_at
       FROM users
       ORDER BY created_at DESC NULLS LAST
       LIMIT 500`,
      [],
      { timeoutMs: 5000, label: 'admin.users', maxRetries: 0 }
    ), { rows: [] }, 'admin.users');

    const items = Array.isArray(result?.rows) ? result.rows : [];
    return res.json({ ok: true, status: 'ok', users: items, items });
  } catch (error) {
    return res.json({ ok: true, status: 'degraded', users: [], items: [] });
  }
});

router.get('/api/admin/diagnostics', requireAdminAccess, async (_req, res) => {
  const telemetry = await safeQuery(() => getTelemetry(), {}, 'admin.diagnostics.telemetry');
  const [
    marketDataCount,
    newsCount,
    earningsCount,
    strategyCount,
    opportunityCount,
  ] = await Promise.all([
    tableCount(['intraday_1m', 'market_quotes', 'stocks_in_play'], 'admin.diagnostics.market_data'),
    tableCount(['news_articles'], 'admin.diagnostics.news'),
    tableCount(['earnings_events', 'earnings_calendar', 'earnings_calendar_cache'], 'admin.diagnostics.earnings'),
    tableCount(['trade_setups', 'trade_signals'], 'admin.diagnostics.strategy'),
    tableCount(['opportunity_stream'], 'admin.diagnostics.opportunity'),
  ]);
  const scheduler = safeQuery(() => Promise.resolve(getEngineSchedulerHealth()), {}, 'admin.diagnostics.scheduler');

  return res.json({
    ok: true,
    status: 'ok',
    source: 'cache',
    telemetry: telemetry || {},
    database_health: {
      tables: {
        intraday_1m: marketDataCount,
        news_articles: newsCount,
        earnings_events: earningsCount,
        trade_setups: strategyCount,
        opportunity_stream: opportunityCount,
      },
    },
    scheduler: await scheduler,
    event_bus: getEventBusHealth() || {},
    integrity: getDataIntegrityHealth() || {},
    alert_system: getSystemAlertEngineHealth() || {},
    checked_at: new Date().toISOString(),
  });
});

router.get('/api/admin/intelligence', requireAdminAccess, async (_req, res) => {
  const telemetry = await safeQuery(() => getTelemetry(), {}, 'admin.intelligence.telemetry');
  return res.json({
    ok: true,
    source: 'cache',
    pipeline_runtime: telemetry?.pipeline_runtime || null,
    flow_runtime: telemetry?.flow_runtime || null,
    squeeze_runtime: telemetry?.squeeze_runtime || null,
    opportunity_runtime: telemetry?.opportunity_runtime || null,
    avg_engine_runtime: telemetry?.avg_engine_runtime || 0,
    last_update: telemetry?.last_update || null,
  });
});

router.get('/api/admin/providers', requireAdminAccess, async (_req, res) => {
  const providers = await safeQuery(() => Promise.resolve(getProviderHealth()), { providers: {} }, 'admin.providers');
  return res.json({ ok: true, source: 'cache', ...(providers || { providers: {} }) });
});

router.get('/api/admin/features', requireAdminAccess, async (_req, res) => {
  const users = await tableCount(['users'], 'admin.features.users');
  const roles = await tableCount(['roles', 'user_roles'], 'admin.features.roles');
  const audit = await tableCount(['audit_log', 'feature_access_audit'], 'admin.features.audit');
  return res.json({
    ok: true,
    source: 'cache',
    status: users === 0 && roles === 0 && audit === 0 ? 'table_missing' : 'ok',
    users,
    roles,
    audit_log: audit,
  });
});

router.get('/api/admin/audit', requireAdminAccess, async (_req, res) => {
  const hasAuditLog = await tableExists('audit_log');
  if (!hasAuditLog) {
    return res.json({ ok: true, status: 'table_missing', items: [] });
  }

  const result = await safeQuery(
    () => queryWithTimeout(
      `SELECT id, actor, action, target, created_at
       FROM audit_log
       ORDER BY created_at DESC NULLS LAST
       LIMIT 200`,
      [],
      { timeoutMs: 5000, label: 'admin.audit', maxRetries: 0 }
    ),
    { rows: [] },
    'admin.audit'
  );

  return res.json({ ok: true, status: 'ok', items: result.rows || [] });
});

router.get('/api/admin/system', requireAdminAccess, async (_req, res) => {
  const [telemetry, providers, eventRows, integrityRows, alertRows] = await Promise.all([
    safeQuery(() => getTelemetry(), {}, 'admin.system.telemetry'),
    safeQuery(() => Promise.resolve(getProviderHealth()), { providers: {} }, 'admin.system.providers'),
    safeQuery(
      () => queryWithTimeout(
        `SELECT id, event_type, source, symbol, payload, created_at
         FROM system_events
         ORDER BY created_at DESC
         LIMIT 100`,
        [],
        { timeoutMs: 5000, label: 'admin.system.events', maxRetries: 0 }
      ),
      { rows: [] },
      'admin.system.events'
    ),
    safeQuery(
      () => queryWithTimeout(
        `SELECT id, event_type, source, symbol, issue, severity, payload, created_at
         FROM data_integrity_events
         ORDER BY created_at DESC
         LIMIT 100`,
        [],
        { timeoutMs: 5000, label: 'admin.system.integrity', maxRetries: 0 }
      ),
      { rows: [] },
      'admin.system.integrity'
    ),
    safeQuery(
      () => queryWithTimeout(
        `SELECT id, type, source, severity, message, acknowledged, created_at
         FROM system_alerts
         ORDER BY created_at DESC
         LIMIT 100`,
        [],
        { timeoutMs: 5000, label: 'admin.system.alerts', maxRetries: 0 }
      ),
      { rows: [] },
      'admin.system.alerts'
    ),
  ]);

  const requiredTables = [
    'users',
    'feature_registry',
    'user_feature_access',
    'trade_setups',
    'opportunity_stream',
    'market_quotes',
    'news_articles',
  ];

  const tableChecks = await Promise.all(requiredTables.map((name) => tableExists(name)));
  const databaseTables = tableChecks.filter(Boolean).length;
  const providersOnline = Object.values(providers?.providers || {}).filter((item) => item?.status === 'ok').length;

  const pipelineEngines = [
    telemetry?.pipeline_runtime,
    telemetry?.flow_runtime,
    telemetry?.squeeze_runtime,
    telemetry?.opportunity_runtime,
  ];
  const enginesRunning = pipelineEngines.filter((engine) => engine && engine.status !== 'failed').length;

  return res.json({
    ok: true,
    system_status: enginesRunning > 0 ? 'ok' : 'warning',
    database_tables: databaseTables,
    engines_running: enginesRunning,
    providers_online: providersOnline,
    engine_health: telemetry || {},
    provider_health: providers?.providers || {},
    event_bus_health: getEventBusHealth() || {},
    integrity_health: getDataIntegrityHealth() || {},
    alert_engine_health: getSystemAlertEngineHealth() || {},
    pipeline_runtime: telemetry?.pipeline_runtime || null,
    cache_health: {
      ticker_cache: telemetry?.ticker_runtime?.status || 'unknown',
      sparkline_cache_rows: Number(telemetry?.sparkline_runtime?.rows || 0),
      cache_refresh_time: telemetry?.last_update || null,
    },
    recent_events: eventRows.rows || [],
    integrity_events: integrityRows.rows || [],
    system_alerts: alertRows.rows || [],
    checked_at: new Date().toISOString(),
  });
});

router.get('/api/admin/email-status', requireAdminAccess, async (_req, res) => {
  const status = getEmailDispatcherStatus();

  const subscribers = await safeQuery(
    () => queryWithTimeout(
      `SELECT COUNT(*)::int AS total
       FROM newsletter_subscribers
       WHERE is_active = TRUE`,
      [],
      { timeoutMs: 5000, label: 'admin.email_status.subscribers', maxRetries: 0 }
    ),
    { rows: [{ total: 0 }] },
    'admin.email_status.subscribers'
  );

  const recent = await safeQuery(
    () => queryWithTimeout(
      `SELECT sent_at, campaign_type, campaign_key, recipients_count, status
       FROM newsletter_send_history
       ORDER BY sent_at DESC NULLS LAST
       LIMIT 10`,
      [],
      { timeoutMs: 5000, label: 'admin.email_status.history', maxRetries: 0 }
    ),
    { rows: [] },
    'admin.email_status.history'
  );

  return res.json({
    success: true,
    data: {
      provider: 'Resend',
      providerConfigured: Boolean(process.env.RESEND_API_KEY),
      fallbackRecipient: process.env.ADMIN_EMAIL || 'jamesharris4@me.com',
      schedulerRunning: Boolean(status?.schedulerRunning ?? status?.schedulerStarted),
      timezone: status?.timezone || 'Europe/London',
      nextMorningBrief: status?.nextMorningBrief || null,
      scheduler: status,
      activeSubscribers: Number(subscribers?.rows?.[0]?.total || 0),
      recentSends: recent?.rows || [],
    },
  });
});

const emailTestMiddleware = process.env.NODE_ENV === 'production'
  ? requireAdminAccess
  : (_req, _res, next) => next();

router.post('/api/admin/email-test', emailTestMiddleware, async (req, res) => {
  try {
    const recipient = String(req.body?.recipient || req.body?.email || process.env.ADMIN_EMAIL || 'jamesharris4@me.com').trim();
    const newsletterType = String(req.body?.newsletterType || 'all').toLowerCase().trim();

    let results;
    if (newsletterType === 'beacon_morning') {
      results = {
        beaconMorningBrief: await sendBeaconMorningBrief({
          force: true,
          forceTo: recipient,
          campaignKey: `test_beacon_${Date.now()}`,
        }),
      };
    } else if (newsletterType === 'system_monitor') {
      results = {
        systemMonitor: await sendSystemMonitor({
          force: true,
          forceTo: recipient,
          campaignKey: `test_sysmon_${Date.now()}`,
        }),
      };
    } else if (newsletterType === 'stocks_in_play') {
      results = {
        stocksInPlay: await sendStocksInPlayAlert({
          force: true,
          forceTo: recipient,
          campaignKey: `test_stocks_in_play_${Date.now()}`,
        }),
      };
    } else {
      const baseline = await sendImmediateAdminTests(recipient);
      results = {
        ...baseline,
        stocksInPlay: await sendStocksInPlayAlert({
          force: true,
          forceTo: recipient,
          campaignKey: `test_stocks_in_play_${Date.now()}`,
        }),
      };
    }

    return res.json({ success: true, recipient, result: results, data: results });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to run test sends' });
  }
});

module.exports = router;
