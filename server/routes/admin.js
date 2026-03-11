const express = require('express');
const cache = require('../utils/cache');
const usageStore = require('../utils/usageStore');
const market = require('../services/marketDataService');
const db = require('../db');
const { POLYGON_API_KEY, FINVIZ_NEWS_TOKEN, FINNHUB_API_KEY, NODE_ENV } = require('../utils/config');
const requireAdmin = require('../middleware/requireAdmin');
const requireRole = require('../middleware/requireRole');
const { getTelemetry } = require('../cache/telemetryCache');
const { getProviderHealth } = require('../engines/providerHealthEngine');
const { getEventBusHealth } = require('../events/eventLogger');
const { getDataIntegrityHealth } = require('../engines/dataIntegrityEngine');
const { getSystemAlertEngineHealth } = require('../engines/systemAlertEngine');
const { getEngineSchedulerHealth } = require('../system/engineScheduler');
const { queryWithTimeout } = require('../db/pg');
const PPLX_API_KEY = process.env.PPLX_API_KEY || null;

const router = express.Router();

router.get('/api/admin/stats', requireAdmin, requireRole('admin'), async (req, res) => {
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

router.get('/api/admin/usage', requireAdmin, requireRole('admin'), async (req, res) => {
  const windowMinutes = Math.min(parseInt(req.query.minutes, 10) || 60, 24 * 60);
  const usage = await db.getUsage({ minutes: windowMinutes });
  res.json(usage);
});

router.get('/api/admin/users', requireAdmin, requireRole('admin'), async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, email, is_admin, is_active, created_at
       FROM users
       ORDER BY created_at DESC NULLS LAST
       LIMIT 500`
    );

    const items = Array.isArray(result?.rows) ? result.rows : [];
    return res.json({ ok: true, items });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to load users',
      detail: error?.message || 'Unknown error',
      items: [],
    });
  }
});

router.get('/api/admin/diagnostics', requireAdmin, requireRole('admin'), async (_req, res) => {
  try {
    const telemetry = await getTelemetry();
    const scheduler = getEngineSchedulerHealth();
    return res.json({
      ok: true,
      source: 'cache',
      telemetry,
      scheduler,
      event_bus: getEventBusHealth(),
      integrity: getDataIntegrityHealth(),
      alert_system: getSystemAlertEngineHealth(),
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.get('/api/admin/intelligence', requireAdmin, requireRole('admin'), async (_req, res) => {
  try {
    const telemetry = await getTelemetry();
    return res.json({
      ok: true,
      source: 'cache',
      pipeline_runtime: telemetry.pipeline_runtime || null,
      flow_runtime: telemetry.flow_runtime || null,
      squeeze_runtime: telemetry.squeeze_runtime || null,
      opportunity_runtime: telemetry.opportunity_runtime || null,
      avg_engine_runtime: telemetry.avg_engine_runtime || 0,
      last_update: telemetry.last_update || null,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.get('/api/admin/providers', requireAdmin, requireRole('admin'), async (_req, res) => {
  try {
    return res.json({ ok: true, source: 'cache', ...getProviderHealth() });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, providers: {} });
  }
});

router.get('/api/admin/features', requireAdmin, requireRole('admin'), async (_req, res) => {
  try {
    const users = await queryWithTimeout('SELECT COUNT(*)::int AS count FROM users', [], { timeoutMs: 3000, label: 'admin.features.users', maxRetries: 0 }).catch(() => ({ rows: [{ count: 0 }] }));
    const roles = await queryWithTimeout('SELECT COUNT(*)::int AS count FROM roles', [], { timeoutMs: 3000, label: 'admin.features.roles', maxRetries: 0 }).catch(() => ({ rows: [{ count: 0 }] }));
    const audit = await queryWithTimeout('SELECT COUNT(*)::int AS count FROM audit_log', [], { timeoutMs: 3000, label: 'admin.features.audit', maxRetries: 0 }).catch(() => ({ rows: [{ count: 0 }] }));
    return res.json({
      ok: true,
      source: 'cache',
      users: users.rows?.[0]?.count || 0,
      roles: roles.rows?.[0]?.count || 0,
      audit_log: audit.rows?.[0]?.count || 0,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.get('/api/admin/audit', requireAdmin, requireRole('admin'), async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT id, actor, action, target, created_at
       FROM audit_log
       ORDER BY created_at DESC NULLS LAST
       LIMIT 200`,
      [],
      { timeoutMs: 5000, label: 'admin.audit', maxRetries: 0 }
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, items: [] });
  }
});

module.exports = router;
