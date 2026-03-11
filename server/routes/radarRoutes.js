const express = require('express');
const router = express.Router();
const { queryWithTimeout } = require('../db/pg');
const { runQueryTree } = require('../services/queryEngine');

router.get('/', async (_req, res) => {
  try {
    const rows = (await runQueryTree({ AND: [] }, { limit: 120 })).rows || [];
    const buckets = { A: [], B: [], C: [] };

    rows.forEach((row) => {
      const klass = String(row?.class || '').toUpperCase();
      const target = klass === 'A' ? 'A' : klass === 'B' ? 'B' : 'C';
      buckets[target].push(row);
    });

    return res.json({
      signals: rows,
      A: buckets.A,
      B: buckets.B,
      C: buckets.C,
      status: 'ok',
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return res.json({
      signals: [],
      A: [],
      B: [],
      C: [],
      status: 'error',
      message: 'Radar temporarily unavailable',
    });
  }
});

router.get('/summary', async (_req, res) => {
  try {
    let rows = [];
    try {
      const result = await queryWithTimeout(
        `SELECT
           symbol,
           score,
           strategy,
           catalyst,
           created_at,
           status
         FROM strategy_signals
         WHERE created_at >= NOW() - INTERVAL '1 day'
         ORDER BY score DESC NULLS LAST, created_at DESC
         LIMIT 100`,
        [],
        { timeoutMs: 7000, label: 'api.radar.summary', maxRetries: 0 }
      );
      rows = result.rows;
    } catch (_error) {
      const fallback = await queryWithTimeout(
        `SELECT symbol, created_at
         FROM strategy_signals
         ORDER BY created_at DESC
         LIMIT 100`,
        [],
        { timeoutMs: 7000, label: 'api.radar.summary.fallback', maxRetries: 0 }
      );
      rows = fallback.rows;
    }

    res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to load radar summary',
      detail: error.message,
    });
  }
});

module.exports = router;
