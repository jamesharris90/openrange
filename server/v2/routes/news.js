const express = require('express');
const { getCache, setCache } = require('../cache/memoryCache');
const { getNewsRows } = require('../services/newsService');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const cached = getCache('news-v2-clean');
    if (cached) {
      return res.json(cached);
    }

    const rows = await getNewsRows();
    const payload = {
      success: true,
      count: rows.length,
      data: rows,
    };

    setCache('news-v2-clean', payload, 60000);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;