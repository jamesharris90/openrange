const express = require('express');
const market = require('../services/marketDataService');
const { pool } = require('../db/pg');
const router = express.Router();

router.get('/api/news', async (req, res) => {
  try {
    const symbols = String(req.query.symbols || req.query.symbol || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const cutoff = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

    let rows;
    if (symbols.length > 0) {
      const result = await pool.query(
        `SELECT symbol, headline, source, url, published_at AS "publishedAt"
         FROM news_articles
         WHERE symbol = ANY($1::text[]) AND published_at >= $2
         ORDER BY published_at DESC
         LIMIT $3`,
        [symbols, cutoff, limit],
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT symbol, headline, source, url, published_at AS "publishedAt"
         FROM news_articles
         WHERE published_at >= $1
         ORDER BY published_at DESC
         LIMIT $2`,
        [cutoff, limit],
      );
      rows = result.rows;
    }

    const payload = rows.map((item) => ({
      symbol: item.symbol,
      headline: item.headline || '',
      summary: '',
      source: item.source || 'FMP',
      url: item.url || null,
      publishedAt: item.publishedAt,
      newsScore: null,
    }));

    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch news', detail: err.message });
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
