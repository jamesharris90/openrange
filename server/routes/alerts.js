const express = require('express');
const { pool } = require('../db/pg');
const { runAlertCycle } = require('../alerts/alert_engine');
const requireFeature = require('../middleware/requireFeature');

const router = express.Router();
router.use(requireFeature('alerts'));

function requireUser(req, res) {
  if (!req.user?.id) {
    res.status(401).json({ error: 'Authenticated user required' });
    return null;
  }
  return String(req.user.id);
}

router.get('/alerts', async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const { rows } = await pool.query(
      `SELECT alert_id, user_id, alert_name, query_tree, message_template, frequency, enabled, created_at, last_triggered
       FROM user_alerts
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list alerts', detail: error.message });
  }
});

router.post('/alerts/create', async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const {
    alert_name,
    query_tree,
    message_template,
    frequency = 60,
    enabled = true,
    enable_alert,
  } = req.body || {};

  const shouldCreate = enable_alert === undefined ? true : Boolean(enable_alert);
  if (!shouldCreate) {
    return res.json({ success: true, skipped: true, reason: 'enable_alert_false' });
  }

  if (!alert_name || typeof alert_name !== 'string') {
    return res.status(400).json({ error: 'alert_name is required' });
  }

  if (!query_tree || typeof query_tree !== 'object') {
    return res.status(400).json({ error: 'query_tree object is required' });
  }

  const freq = Math.max(30, Number(frequency) || 60);

  try {
    const { rows } = await pool.query(
      `INSERT INTO user_alerts (user_id, alert_name, query_tree, message_template, frequency, enabled)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       RETURNING alert_id, user_id, alert_name, query_tree, message_template, frequency, enabled, created_at, last_triggered`,
      [userId, alert_name, JSON.stringify(query_tree), message_template || null, freq, Boolean(enabled)]
    );

    res.json({ success: true, alert: rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create alert', detail: error.message });
  }
});

router.post('/alerts/disable', async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const { alert_id } = req.body || {};
  if (!alert_id) return res.status(400).json({ error: 'alert_id is required' });

  try {
    const { rowCount } = await pool.query(
      `UPDATE user_alerts
       SET enabled = FALSE
       WHERE alert_id = $1 AND user_id = $2`,
      [alert_id, userId]
    );

    if (!rowCount) return res.status(404).json({ error: 'Alert not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disable alert', detail: error.message });
  }
});

router.get('/alerts/history', async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));

  try {
    const { rows } = await pool.query(
      `SELECT h.alert_id, h.symbol, h.triggered_at, h.message
       FROM alert_history h
       JOIN user_alerts a ON a.alert_id = h.alert_id
       WHERE a.user_id = $1
       ORDER BY h.triggered_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load alert history', detail: error.message });
  }
});

router.post('/alerts/run-now', async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const summary = await runAlertCycle();
    res.json({ success: true, summary });
  } catch (error) {
    res.status(500).json({ error: 'Failed to run alert cycle', detail: error.message });
  }
});

router.post('/alerts/test', async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const { alert_id } = req.body || {};
  return res.json({
    success: true,
    tested: Boolean(alert_id),
    alert_id: alert_id || null,
    triggered_at: new Date().toISOString(),
  });
});

module.exports = router;
