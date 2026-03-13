/**
 * server/routes/calibrationRoutes.js
 *
 * Extended calibration API endpoints.
 * Mounted at /api/calibration alongside calibration.js.
 *
 * Routes:
 *   GET /api/calibration/strategy-performance  → strategy_performance_summary
 *   GET /api/calibration/top-signals           → radar_top_trades
 *   GET /api/calibration/health                → calibration_health aggregate
 *   GET /api/calibration/grade-distribution    → signal_grade_distribution
 */

'use strict';

const express = require('express');
const { queryWithTimeout } = require('../db/pg');

const router = express.Router();

// ── GET /api/calibration/strategy-performance ─────────────────
router.get('/strategy-performance', async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT * FROM strategy_performance_summary`,
      [],
      { timeoutMs: 8000, label: 'api.calibration.strategy-performance', maxRetries: 0 }
    );

    return res.json({
      ok: true,
      items: Array.isArray(result?.rows) ? result.rows : [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to load strategy performance',
      detail: error.message,
      items: [],
    });
  }
});

// ── GET /api/calibration/top-signals ─────────────────────────
router.get('/top-signals', async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT
         symbol,
         score,
         trade_plan,
         entry_zone_low,
         entry_zone_high,
         target_1,
         stop_loss,
         generated_at
       FROM radar_top_trades
       LIMIT 20`,
      [],
      { timeoutMs: 8000, label: 'api.calibration.top-signals', maxRetries: 0 }
    );

    return res.json({
      ok: true,
      items: Array.isArray(result?.rows) ? result.rows : [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to load top signals',
      detail: error.message,
      items: [],
    });
  }
});

// ── GET /api/calibration/health ───────────────────────────────
router.get('/health', async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT
         COUNT(*)                                                           AS total_logged,
         COUNT(*) FILTER (WHERE success IS NOT NULL)                       AS evaluated,
         COUNT(*) FILTER (WHERE success IS NULL)                           AS pending_evaluation,
         COUNT(*) FILTER (WHERE success = TRUE)                            AS total_wins,
         ROUND(
           100.0 * COUNT(*) FILTER (WHERE success = TRUE)
           / NULLIF(COUNT(*) FILTER (WHERE success IS NOT NULL), 0),
           2
         )                                                                 AS overall_win_rate_pct,
         MAX(entry_time)                                                   AS last_signal_at,
         COUNT(DISTINCT strategy)                                          AS strategy_count,
         COUNT(DISTINCT symbol)                                            AS symbol_count
       FROM signal_calibration_log`,
      [],
      { timeoutMs: 8000, label: 'api.calibration.health', maxRetries: 0 }
    );

    return res.json({
      ok: true,
      health: result?.rows?.[0] || null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to load calibration health',
      detail: error.message,
      health: null,
    });
  }
});

// ── GET /api/calibration/grade-distribution ───────────────────
router.get('/grade-distribution', async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT
         setup_grade,
         COUNT(*)                                                            AS total,
         COUNT(*) FILTER (WHERE success = TRUE)                             AS wins,
         ROUND(
           100.0 * COUNT(*) FILTER (WHERE success = TRUE)
           / NULLIF(COUNT(*) FILTER (WHERE success IS NOT NULL), 0),
           2
         )                                                                  AS win_rate_pct
       FROM signal_calibration_log
       WHERE setup_grade IS NOT NULL
       GROUP BY setup_grade
       ORDER BY setup_grade`,
      [],
      { timeoutMs: 8000, label: 'api.calibration.grade-distribution', maxRetries: 0 }
    );

    return res.json({
      ok: true,
      items: Array.isArray(result?.rows) ? result.rows : [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to load grade distribution',
      detail: error.message,
      items: [],
    });
  }
});

// ── GET /api/calibration/strategy-weights ─────────────────────
router.get('/strategy-weights', async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT
         strategy,
         weight,
         signals_used,
         win_rate,
         avg_return,
         confidence,
         last_updated
       FROM adaptive_strategy_rank
       LIMIT 100`,
      [],
      { timeoutMs: 8000, label: 'api.calibration.strategy-weights', maxRetries: 0 }
    );

    return res.json({
      ok: true,
      items: Array.isArray(result?.rows) ? result.rows : [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to load strategy weights',
      detail: error.message,
      items: [],
    });
  }
});

module.exports = router;
