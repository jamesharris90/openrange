const express = require('express');
const market = require('../services/marketDataService');
const router = express.Router();

router.get('/api/gappers', async (_req, res) => {
  try {
    const gappers = await market.getGappers();
    res.json({ gappers });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch gappers', detail: err.message });
  }
});

module.exports = router;
