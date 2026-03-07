const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/strategy', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT strategy,
             COUNT(*) as trades,
             AVG(max_upside) as avg_gain
      FROM signal_performance
      GROUP BY strategy
      ORDER BY avg_gain DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('[PERFORMANCE API ERROR]', err);
    res.status(500).json({ error: 'performance query failed' });
  }
});

module.exports = router;
