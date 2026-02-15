const express = require('express');
const market = require('../services/marketDataService');
const router = express.Router();

router.get('/api/news', async (_req, res) => {
  try {
    const news = await market.getMarketNews();
    res.json(news);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch news', detail: err.message });
  }
});

router.get(['/api/finnhub/news/symbol', '/api/news/symbol'], async (req, res) => {
  const symbol = (req.query.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const news = await market.getNews(symbol);
    res.json(news);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch news', detail: err.message });
  }
});

module.exports = router;
