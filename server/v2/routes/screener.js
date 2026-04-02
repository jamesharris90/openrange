const express = require('express');
const { getCache, setCache } = require('../cache/memoryCache');
const { getScreenerRows } = require('../services/screenerService');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const cached = getCache('screener');
    if (cached) {
      return res.json(cached);
    }

    const { rows, fallbackUsed, macroContext } = await getScreenerRows();
    const payload = {
      success: true,
      count: rows.length,
      fallbackUsed,
      macro_context: macroContext,
      data: rows,
    };

    setCache('screener', payload, 60000);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;