const express = require('express');
const market = require('../services/marketDataService');
const { supabaseAdmin } = require('../services/supabaseClient');
const { getLatestNews } = require('../repositories/newsRepository');
const router = express.Router();

router.get('/api/news', async (req, res) => {
  try {
    const symbols = String(req.query.symbols || req.query.symbol || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const cutoff = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

    const rows = await getLatestNews(supabaseAdmin, {
      symbols,
      limit,
      cutoffIso: cutoff,
    });

    const payload = rows.map((item) => ({
      symbol: item.symbol,
      headline: item.headline || '',
      summary: '',
      source: item.source || 'FMP',
      url: item.url || null,
      publishedAt: item.published_at,
      newsScore: null,
    }));

    res.json(payload);
  } catch (err) {
    res.json([]);
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
