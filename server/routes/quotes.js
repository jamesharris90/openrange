const express = require('express');
const market = require('../services/marketDataService');
const router = express.Router();

router.get('/api/yahoo/quote-batch', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });
  try {
    const quotes = await market.getQuotes(symbols);
    res.json({ quotes });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch quotes', detail: err.message });
  }
});

router.get('/api/yahoo/quote', async (req, res) => {
  const symbol = (req.query.symbol || req.query.t || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const quotes = await market.getQuotes([symbol]);
    res.json(quotes[0] || null);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch quote', detail: err.message });
  }
});

router.get('/api/yahoo/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query || query.length < 2) return res.json([]);
  try {
    const results = await market.searchSymbols(query);
    res.json(results);
  } catch (err) {
    res.status(502).json({ error: 'Failed to search symbols', detail: err.message });
  }
});

module.exports = router;
