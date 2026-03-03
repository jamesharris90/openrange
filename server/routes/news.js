const express = require('express');
const axios = require('axios');
const market = require('../services/marketDataService');
const pool = require('../db/pg');
const router = express.Router();

const FMP_NEWS_URL = 'https://financialmodelingprep.com/stable/news/stock-latest';

router.get('/api/news', async (req, res) => {
  const provider = String(req.query.provider || '').trim().toLowerCase();
  if (provider === 'fmp') {
    const symbols = String(req.query.symbols || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));

    // DB-first: query news_events table
    if (symbols.length > 0) {
      try {
        const cutoff = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
        const { rows } = await pool.query(
          `SELECT symbol, headline, source, url, published_at AS "publishedAt"
           FROM news_events
           WHERE symbol = ANY($1::text[]) AND published_at >= $2
           ORDER BY published_at DESC
           LIMIT $3`,
          [symbols, cutoff, limit],
        );
        if (rows.length > 0) {
          const payload = rows.map((item) => ({
            symbol: item.symbol,
            headline: item.headline || '',
            summary: '',
            source: item.source || 'FMP',
            url: item.url || null,
            publishedAt: item.publishedAt,
            newsScore: null,
          }));
          return res.json(payload);
        }
      } catch (_err) { /* fall through to FMP live */ }
    }

    // FMP live fallback
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'FMP_API_KEY missing' });

    try {
      const response = await axios.get(FMP_NEWS_URL, {
        params: {
          symbols: symbols.length ? symbols.join(',') : undefined,
          limit,
          apikey: apiKey,
        },
        timeout: 30000,
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        return res.status(502).json({ error: 'Failed to fetch FMP news', detail: `status ${response.status}` });
      }

      const rows = Array.isArray(response.data) ? response.data : [];
      const payload = rows.map((item) => ({
        symbol: String(item?.symbol || '').toUpperCase(),
        headline: item?.title || '',
        summary: item?.text || item?.summary || '',
        source: item?.site || item?.source || 'FMP',
        url: item?.url || null,
        publishedAt: item?.publishedDate || item?.published_at || null,
        newsScore: Number.isFinite(Number(item?.news_score)) ? Number(item.news_score) : null,
      }));

      return res.json(payload);
    } catch (err) {
      return res.status(502).json({ error: 'Failed to fetch FMP news', detail: err.message });
    }
  }

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
