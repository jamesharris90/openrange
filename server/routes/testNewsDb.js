const express = require('express');
const router = express.Router();
const pool = require('../pg');

router.get('/test-news-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM news_articles');
    res.json({
      ok: true,
      table: 'news_articles',
      rowCount: parseInt(result.rows[0].count, 10)
    });
  } catch (err) {
    console.error('News DB test error:', err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

module.exports = router;
