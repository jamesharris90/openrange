'use strict';

const express = require('express');
const { queryWithTimeout } = require('../db/pg');
const { requireAdminAccess } = require('../middleware/requireAdminAccess');

const router = express.Router();

router.get('/api/admin/validation/daily', requireAdminAccess, async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT *
       FROM signal_validation_daily
       ORDER BY date DESC
       LIMIT 30`,
      [],
      { timeoutMs: 8000, label: 'admin.validation.daily', maxRetries: 0 }
    );
    return res.json({ ok: true, items: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load daily validation', detail: error.message, items: [] });
  }
});

router.get('/api/admin/validation/weekly', requireAdminAccess, async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `SELECT *
       FROM signal_validation_weekly
       ORDER BY week_start DESC
       LIMIT 24`,
      [],
      { timeoutMs: 8000, label: 'admin.validation.weekly', maxRetries: 0 }
    );
    return res.json({ ok: true, items: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load weekly validation', detail: error.message, items: [] });
  }
});

router.get('/api/admin/validation/missed', requireAdminAccess, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const result = await queryWithTimeout(
      `SELECT
         id,
         symbol,
         date,
         high_move_percent AS move_percent,
         reason,
         COALESCE(replayed, false) AS replayed,
         high_price,
         low_price,
         close_price,
         created_at
       FROM missed_opportunities
       ORDER BY date DESC, created_at DESC
       LIMIT $1`,
      [limit],
      { timeoutMs: 8000, label: 'admin.validation.missed', maxRetries: 0 }
    );

    return res.json({ ok: true, items: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load missed opportunities', detail: error.message, items: [] });
  }
});

router.get('/api/admin/validation/learning-score', requireAdminAccess, async (_req, res) => {
  try {
    const [daily, weekly] = await Promise.all([
      queryWithTimeout(
        `SELECT date, learning_score, ranking_accuracy, avg_signal_return, avg_top_rank_return
         FROM signal_validation_daily
         ORDER BY date DESC
         LIMIT 1`,
        [],
        { timeoutMs: 8000, label: 'admin.validation.learning.daily', maxRetries: 0 }
      ),
      queryWithTimeout(
        `SELECT week_start, week_end, learning_score, ranking_accuracy
         FROM signal_validation_weekly
         ORDER BY week_start DESC
         LIMIT 1`,
        [],
        { timeoutMs: 8000, label: 'admin.validation.learning.weekly', maxRetries: 0 }
      ),
    ]);

    return res.json({
      ok: true,
      daily: daily?.rows?.[0] || null,
      weekly: weekly?.rows?.[0] || null,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load learning score', detail: error.message });
  }
});

router.get('/api/admin/validation/missed-candles', requireAdminAccess, async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const date = String(req.query.date || '').trim();

  if (!symbol || !date) {
    return res.status(400).json({ ok: false, error: 'symbol and date are required', items: [] });
  }

  try {
    const result = await queryWithTimeout(
      `SELECT
         symbol,
         date,
         open,
         high,
         low,
         close,
         volume
       FROM daily_ohlc
       WHERE symbol = $1
         AND date BETWEEN ($2::date - INTERVAL '15 day') AND ($2::date + INTERVAL '15 day')
       ORDER BY date ASC`,
      [symbol, date],
      { timeoutMs: 8000, label: 'admin.validation.missed_candles', maxRetries: 0 }
    );

    return res.json({ ok: true, items: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load missed opportunity candles', detail: error.message, items: [] });
  }
});

module.exports = router;
