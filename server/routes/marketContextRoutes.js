const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      WITH symbols(symbol) AS (
        VALUES
          ('SPY'), ('QQQ'), ('VIX'), ('SMH'), ('XLF'), ('EURUSD'), ('BTC')
      ),
      metric_rows AS (
        SELECT
          m.symbol,
          COALESCE((to_jsonb(m)->>'close')::numeric, (to_jsonb(m)->>'price')::numeric, q.price) AS current_price,
          COALESCE((to_jsonb(m)->>'prev_close')::numeric, NULLIF(q.price, 0) / (1 + COALESCE(q.change_percent, 0) / 100.0)) AS prev_close,
          q.sector
        FROM market_metrics m
        LEFT JOIN market_quotes q ON q.symbol = m.symbol
      )
      SELECT
        s.symbol,
        mr.current_price,
        mr.prev_close,
        CASE
          WHEN COALESCE(mr.prev_close, 0) = 0 THEN 0
          ELSE ROUND(((mr.current_price - mr.prev_close) / mr.prev_close) * 100, 2)
        END AS pct_change,
        COALESCE(mr.sector, 'Macro') AS sector
      FROM symbols s
      LEFT JOIN metric_rows mr ON mr.symbol = s.symbol
      ORDER BY s.symbol
    `);

    const result = {};
    rows.forEach((r) => {
      result[r.symbol] = {
        symbol: r.symbol,
        current_price: r.current_price,
        price: r.current_price,
        prev_close: r.prev_close,
        pct_change: Number(r.pct_change || 0),
        change_percent: Number(r.pct_change || 0),
        sector: r.sector,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('[MARKET CONTEXT ERROR]', err);
    res.status(500).json({ error: 'Market context failed' });
  }
});

module.exports = router;
