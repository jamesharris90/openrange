const express = require('express');
const expectedMoveService = require('../services/expectedMoveService');
const router = express.Router();

router.get('/api/yahoo/options', async (req, res) => {
  const ticker = (req.query.t || req.query.symbol || '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.^-]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol' });
  }
  const dateParam = req.query.date || '';
  try {
    let earningsDate = null;
    if (dateParam) {
      const parsed = new Date(Number(dateParam) * 1000);
      earningsDate = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
    }
    const data = await expectedMoveService.getExpectedMove(ticker, earningsDate, 'research');
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch options chain', detail: err.message });
  }
});

module.exports = router;
