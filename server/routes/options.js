const express = require('express');
const market = require('../services/marketDataService');
const router = express.Router();

router.get('/api/yahoo/options', async (req, res) => {
  const ticker = (req.query.t || req.query.symbol || '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.^-]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol' });
  }
  const dateParam = req.query.date || '';
  try {
    const data = await market.getOptions(ticker, dateParam);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch options chain', detail: err.message });
  }
});

module.exports = router;
