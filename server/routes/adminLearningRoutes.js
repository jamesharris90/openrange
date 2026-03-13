'use strict';

const express = require('express');
const { queryWithTimeout } = require('../db/pg');
const { requireAdminAccess } = require('../middleware/requireAdminAccess');

const router = express.Router();

router.get('/api/admin/learning/strategies', requireAdminAccess, async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT
         strategy,
         signals_count,
         win_rate,
         avg_return,
         median_return,
         max_return,
         expected_move_hit_rate,
         false_signal_rate,
         missed_opportunity_rate,
         edge_score,
         learning_score,
         updated_at
       FROM strategy_learning_metrics
       ORDER BY learning_score DESC NULLS LAST`,
      [],
      { timeoutMs: 8000, label: 'admin.learning.strategies', maxRetries: 0 }
    );

    return res.json({ ok: true, items: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load strategy learning metrics', detail: error.message, items: [] });
  }
});

router.get('/api/admin/learning/capture-rate', requireAdminAccess, async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT
         date,
         total_opportunities,
         signals_detected,
         capture_rate,
         avg_missed_move,
         avg_signal_move,
         created_at
       FROM signal_capture_analysis
       ORDER BY date DESC
       LIMIT 90`,
      [],
      { timeoutMs: 8000, label: 'admin.learning.capture_rate', maxRetries: 0 }
    );

    return res.json({ ok: true, items: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load capture analysis', detail: error.message, items: [] });
  }
});

router.get('/api/admin/learning/expected-move', requireAdminAccess, async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT
         DATE(created_at) AS date,
         COUNT(*)::int AS samples,
         AVG(CASE WHEN expected_move_hit THEN 1 ELSE 0 END)::numeric AS hit_rate,
         AVG(expected_move_percent)::numeric AS avg_expected_move_percent,
         AVG(actual_move_percent)::numeric AS avg_actual_move_percent,
         AVG(expected_move_error)::numeric AS avg_expected_move_error,
         AVG(iv_hv_ratio)::numeric AS avg_iv_hv_ratio
       FROM expected_move_tracking
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at) DESC
       LIMIT 90`,
      [],
      { timeoutMs: 8000, label: 'admin.learning.expected_move', maxRetries: 0 }
    );

    return res.json({ ok: true, items: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load expected move analytics', detail: error.message, items: [] });
  }
});

router.get('/api/admin/learning/regime', requireAdminAccess, async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT
         date,
         spy_trend,
         vix_level,
         market_regime,
         sector_strength,
         breadth_percent,
         created_at
       FROM market_regime_daily
       ORDER BY date DESC
       LIMIT 60`,
      [],
      { timeoutMs: 8000, label: 'admin.learning.regime', maxRetries: 0 }
    );

    return res.json({ ok: true, items: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load market regime analytics', detail: error.message, items: [] });
  }
});

module.exports = router;
