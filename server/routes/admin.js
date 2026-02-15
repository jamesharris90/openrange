const express = require('express');
const cache = require('../utils/cache');
const usageStore = require('../utils/usageStore');
const market = require('../services/marketDataService');
const db = require('../db');
const { POLYGON_API_KEY, FINVIZ_NEWS_TOKEN, FINNHUB_API_KEY, NODE_ENV } = require('../utils/config');
const PPLX_API_KEY = process.env.PPLX_API_KEY || null;

const router = express.Router();

router.get('/api/admin/stats', async (req, res) => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }
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

router.get('/api/admin/usage', async (req, res) => {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin only' });
  }
  const windowMinutes = Math.min(parseInt(req.query.minutes, 10) || 60, 24 * 60);
  const usage = await db.getUsage({ minutes: windowMinutes });
  res.json(usage);
});

module.exports = router;
