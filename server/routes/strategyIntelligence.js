const express = require('express');
const { queryWithTimeout } = require('../db/pg');
const { getStrategyPerformance } = require('../engines/strategyEvaluationEngine');

const router = express.Router();

router.get('/strategy/performance', async (req, res) => {
  try {
    const rows = await getStrategyPerformance();
    return res.json({ ok: true, items: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load strategy performance' });
  }
});

router.get('/strategy/trades', async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));

  try {
    const { rows } = await queryWithTimeout(
      `SELECT
         id,
         symbol,
         strategy,
         entry_price,
         exit_price,
         entry_time,
         exit_time,
         max_move,
         result_percent,
         created_at
       FROM strategy_trades
       ORDER BY COALESCE(exit_time, created_at) DESC NULLS LAST
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
