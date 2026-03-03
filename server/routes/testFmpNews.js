const express = require('express');
const router = express.Router();
const { fetchFmpNews } = require('../services/fmpNewsFetch');

router.get('/test-fmp-news', async (req, res) => {
  try {
    const data = await fetchFmpNews(5);

    res.json({
      ok: true,
      count: data.length,
      sample: data.slice(0, 2)
    });
  } catch (err) {
    console.error('FMP fetch error:', err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

module.exports = router;
