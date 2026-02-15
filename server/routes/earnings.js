const express = require('express');
const market = require('../services/marketDataService');
const router = express.Router();

router.get('/api/earnings/calendar', async (req, res) => {
  const from = req.query.from;
  const to = req.query.to;
  try {
    const data = await market.getEarningsCalendar({ from, to });
    res.json(data);
  } catch (err) {
    res.json({ earnings: [], from: from || null, to: to || null, error: 'Failed to fetch earnings calendar', detail: err.message });
  }
});

router.get('/api/earnings-research/:ticker', async (req, res) => {
  const ticker = (req.params.ticker || '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.^-]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol' });
  }
  try {
    const data = await market.getEarningsResearch(ticker);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch earnings research data', detail: err.message });
  }
});

module.exports = router;
