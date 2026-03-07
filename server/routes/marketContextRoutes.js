const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      WITH symbols(symbol) AS (
        VALUES
          ('SPY'), ('QQQ'), ('IWM'), ('VIX'),
          ('NVDA'), ('AAPL'), ('MSFT'), ('AMZN'), ('TSLA')
      )
      SELECT
        s.symbol,
        COALESCE(m.price, q.price) AS price,
        COALESCE(m.change_percent, q.change_percent) AS change_percent
      FROM symbols s
      LEFT JOIN market_metrics m ON m.symbol = s.symbol
      LEFT JOIN market_quotes q ON q.symbol = s.symbol
      ORDER BY s.symbol
    `);

    const result = {};
    rows.forEach((r) => {
      result[r.symbol] = r;
    });

    res.json(result);
  } catch (err) {
    console.error('[MARKET CONTEXT ERROR]', err);
    res.status(500).json({ error: 'Market context failed' });
  }
});

module.exports = router;
