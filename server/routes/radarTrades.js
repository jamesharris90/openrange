const express = require('express');
const { pool } = require('../db/pg');

const router = express.Router();

router.get('/top-trades', async (_req, res) => {
  try {
    const result = await pool.query(`
      select *
      from radar_top_trades
      order by score desc
      limit 10
    `);

    return res.json({
      ok: true,
      trades: Array.isArray(result?.rows) ? result.rows : [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to load top trades',
      detail: error.message,
      trades: [],
    });
  }
});

module.exports = router;
