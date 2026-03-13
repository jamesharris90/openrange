const express = require('express');
const { queryWithTimeout } = require('../db/pg');
const { ensureSignalRouterTables } = require('../system/signalRouter');
const { ensureSignalHierarchyTable } = require('../engines/signalHierarchyEngine');
const requireFeature = require('../middleware/requireFeature');
const { supabaseAdmin } = require('../services/supabaseClient');
const { getLatestSignalAlerts } = require('../repositories/alertsRepository');

const router = express.Router();

router.get('/signals/watchlist', async (req, res) => {
  try {
    await ensureSignalRouterTables();
    const { rows } = await queryWithTimeout(
      `SELECT *
       FROM dynamic_watchlist
       ORDER BY score DESC NULLS LAST
       LIMIT 20`,
      [],
      { timeoutMs: 7000, label: 'routes.signals.watchlist', maxRetries: 0 }
    );

    return res.json({ ok: true, items: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load watchlist signals' });
  }
});

router.get('/signals/alerts', async (req, res) => {
  try {
    await ensureSignalRouterTables();
    const rows = await getLatestSignalAlerts(supabaseAdmin, { limit: 50 });

    return res.json({ ok: true, items: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load signal alerts' });
  }
});

router.get('/signals/:symbol/score', async (req, res) => {
  const symbol = String(req.params.symbol || '').toUpperCase().trim();
  if (!symbol) return res.status(400).json({ ok: false, error: 'Invalid symbol' });

  try {
    await ensureSignalHierarchyTable();
    const { rows } = await queryWithTimeout(
      `SELECT
         s.symbol,
         s.score,
         s.score_breakdown,
         s.narrative,
         s.confidence,
         COALESCE(s.catalyst_type, c.catalyst_type, 'unknown') AS catalyst,
         COALESCE(s.sector, q.sector, 'Unknown') AS sector,
         s.updated_at
       FROM trade_signals s
       LEFT JOIN LATERAL (
         SELECT catalyst_type
         FROM news_catalysts nc
         WHERE nc.symbol = s.symbol
         ORDER BY nc.published_at DESC NULLS LAST
         LIMIT 1
       ) c ON TRUE
       LEFT JOIN market_quotes q ON q.symbol = s.symbol
       WHERE s.symbol = $1
       LIMIT 1`,
      [symbol],
      { timeoutMs: 7000, label: 'routes.signals.symbol_score', maxRetries: 0 }
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: 'Signal not found' });
    }

    return res.json({ ok: true, item: rows[0] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load signal score' });
  }
});

router.get('/signals/hierarchy', requireFeature('signal_intelligence_admin'), async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 25;

  try {
    const { rows } = await queryWithTimeout(
      `SELECT
         symbol,
         hierarchy_rank,
         signal_class,
         strategy,
         score,
         confidence,
         updated_at
       FROM signal_hierarchy
       ORDER BY hierarchy_rank DESC NULLS LAST, score DESC NULLS LAST
       LIMIT $1`,
      [limit],
      { timeoutMs: 7000, label: 'routes.signals.hierarchy', maxRetries: 0 }
    );

    return res.json({ ok: true, items: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load signal hierarchy' });
  }
});

module.exports = router;
