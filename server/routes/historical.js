const express = require('express');
const market = require('../services/marketDataService');
const router = express.Router();

router.get('/api/yahoo/history', async (req, res) => {
  const symbol = (req.query.symbol || req.query.t || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const interval = req.query.interval || '1d';
  const range = req.query.range || '1mo';
  try {
    const data = await market.getHistorical(symbol, { interval, range });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch history', detail: err.message });
  }
});

router.get('/api/yahoo/hv', async (req, res) => {
  const symbol = (req.query.symbol || req.query.t || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const interval = req.query.interval || '1d';
  const range = req.query.range || '6mo';
  try {
    const data = await market.getHistorical(symbol, { interval, range });
    const quotes = (data.quotes || []).filter(q => q.close != null);
    if (!quotes.length) return res.status(404).json({ error: `No history for ${symbol}` });
    const closes = quotes.map(q => q.close);
    const hv = computeHVMetrics(closes);
    res.json({
      ticker: symbol,
      count: closes.length,
      ...(hv || { hvCurrent20: null, hvHigh52w: null, hvLow52w: null, hvRank: null }),
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch price history', detail: err.message });
  }
});

function computeHVMetrics(closes) {
  if (!closes || closes.length < 22) return null;
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  const window = 20;
  const hvValues = [];
  for (let i = window; i <= returns.length; i++) {
    const slice = returns.slice(i - window, i);
    const mean = slice.reduce((a, b) => a + b, 0) / window;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (window - 1);
    const annualized = Math.sqrt(variance) * Math.sqrt(252);
    hvValues.push(annualized);
  }
  if (hvValues.length === 0) return null;
  const current = hvValues[hvValues.length - 1];
  const high = Math.max(...hvValues);
  const low = Math.min(...hvValues);
  const rank = high !== low ? ((current - low) / (high - low)) * 100 : 50;
  return {
    hvCurrent20: +current.toFixed(4),
    hvHigh52w: +high.toFixed(4),
    hvLow52w: +low.toFixed(4),
    hvRank: +rank.toFixed(2),
  };
}

module.exports = router;
