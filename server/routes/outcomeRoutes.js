const express = require('express');
const router = express.Router();

const {
  getPerformanceMetrics,
  getTradeHistory,
  getStrategyPerformance,
} = require('../engines/tradeOutcomeEngine');

router.get('/performance', async (req, res) => {
  try {
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 200;
    const rows = await getPerformanceMetrics(limit);
    return res.json({ ok: true, count: rows.length, items: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load performance metrics' });
  }
});

router.get('/trade-history', async (req, res) => {
  try {
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 200;
    const rows = await getTradeHistory(limit);
    return res.json({ ok: true, count: rows.length, items: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load trade history' });
  }
});

router.get('/strategy-stats', async (req, res) => {
  try {
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 100;
    const rows = await getStrategyPerformance(limit);
    return res.json({ ok: true, count: rows.length, items: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load strategy stats' });
  }
});

module.exports = router;
