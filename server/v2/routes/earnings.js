const express = require('express');
const { getCache, setCache } = require('../cache/memoryCache');
const { getEarningsRows } = require('../services/earningsService');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const cached = getCache('earnings');
    if (cached) {
      return res.json(cached);
    }

    const rows = await getEarningsRows();
    const payload = {
      success: true,
      count: rows.length,
      data: rows,
    };

    setCache('earnings', payload, 60000);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;