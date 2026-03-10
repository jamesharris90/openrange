const express = require('express');
const { queryWithTimeout } = require('../db/pg');
const { getStrategyPerformance } = require('../engines/strategyEvaluationEngine');
const requireFeature = require('../middleware/requireFeature');

const router = express.Router();

router.get('/strategy/performance', requireFeature('strategy_evaluation'), async (req, res) => {
  try {
    const rows = await getStrategyPerformance();
    return res.json({ ok: true, items: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load strategy performance' });
  }
});

router.get('/strategy/trades', requireFeature('strategy_evaluation'), async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));

  try {
    const { rows } = await queryWithTimeout(
      `SELECT
        t.id,
         t.symbol,
         t.strategy,
         t.entry_price,
         t.exit_price,
         t.entry_time,
         t.exit_time,
         t.max_move,
         t.result_percent,
         t.created_at,
         s.confidence,
         COALESCE(s.catalyst_type, 'unknown') AS catalyst_type,
         COALESCE(s.sector, q.sector, 'Unknown') AS sector,
         CASE
           WHEN t.entry_time IS NOT NULL AND t.exit_time IS NOT NULL THEN EXTRACT(EPOCH FROM (t.exit_time - t.entry_time)) / 3600.0
           ELSE NULL
         END AS hold_hours
       FROM strategy_trades t
       LEFT JOIN trade_signals s ON s.symbol = t.symbol
       LEFT JOIN market_quotes q ON q.symbol = t.symbol
      ORDER BY COALESCE(t.exit_time, t.created_at) DESC NULLS LAST
       LIMIT $1`,
      [limit],
      { timeoutMs: 7000, label: 'routes.strategy.trades', maxRetries: 0 }
    );

    return res.json({ ok: true, items: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load strategy trades' });
  }
});

router.get('/narratives/latest', async (req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT id, narrative, regime, created_at
       FROM market_narratives
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [],
      { timeoutMs: 7000, label: 'routes.narratives.latest', maxRetries: 0 }
    );

    const row = rows[0] || null;
    let parsed = [];
    if (row?.narrative) {
      try {
        parsed = JSON.parse(row.narrative);
      } catch {
        parsed = [{ sector: 'Market', narrative: String(row.narrative), confidence: 0.5, affected_symbols: [] }];
      }
    }

    return res.json({
      ok: true,
      regime: row?.regime || 'Neutral',
      generated_at: row?.created_at || null,
      items: Array.isArray(parsed) ? parsed : [],
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load latest narratives' });
  }
});

module.exports = router;
