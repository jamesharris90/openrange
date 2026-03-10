const express = require('express');
const cache = require('../utils/cache');
const usageStore = require('../utils/usageStore');
const market = require('../services/marketDataService');
const db = require('../db');
const { POLYGON_API_KEY, FINVIZ_NEWS_TOKEN, FINNHUB_API_KEY, NODE_ENV } = require('../utils/config');
const requireAdmin = require('../middleware/requireAdmin');
const PPLX_API_KEY = process.env.PPLX_API_KEY || null;

const router = express.Router();

router.get('/api/admin/stats', requireAdmin, async (req, res) => {
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

router.get('/api/admin/usage', requireAdmin, async (req, res) => {
  const windowMinutes = Math.min(parseInt(req.query.minutes, 10) || 60, 24 * 60);
  const usage = await db.getUsage({ minutes: windowMinutes });
  res.json(usage);
});

router.get('/api/admin/users', requireAdmin, async (_req, res) => {
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

module.exports = router;
