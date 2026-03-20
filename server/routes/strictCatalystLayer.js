const express = require('express');
const { queryWithTimeout } = require('../db/pg');
const { getOpportunities } = require('../controllers/opportunitiesController');

const router = express.Router();

router.get('/catalysts', async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT * FROM catalyst_events
       WHERE source_table IN ('news_articles', 'earnings_calendar', 'ipo_calendar', 'stock_splits')
       ORDER BY COALESCE(event_time, published_at, created_at) DESC
       LIMIT 500`,
      [],
      { label: 'api.strict.catalysts', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 100 }
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load catalysts' });
  }
});

router.get('/signals', async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT * FROM signals ORDER BY created_at DESC LIMIT 500`,
      [],
      { label: 'api.strict.signals', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 100 }
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load signals' });
  }
});

router.get('/opportunities', getOpportunities);

router.get('/macro', async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT * FROM macro_narratives ORDER BY created_at DESC LIMIT 200`,
      [],
      { label: 'api.strict.macro', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 100 }
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load macro narratives' });
  }
});

module.exports = router;
