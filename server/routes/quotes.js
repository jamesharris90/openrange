const express = require('express');
const axios = require('axios');
const market = require('../services/marketDataService');
const expectedMoveService = require('../services/expectedMoveService');
const router = express.Router();

const FMP_BASE = 'https://financialmodelingprep.com';

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

router.get('/api/quote', async (req, res) => {
  const symbol = String(req.query.symbol || req.query.t || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FMP_API_KEY missing' });

  try {
    const [quoteResp, profileResp, expectedMove] = await Promise.all([
      axios.get(`${FMP_BASE}/stable/quote`, {
        params: { symbol, apikey: apiKey },
        timeout: 15000,
        validateStatus: () => true,
      }),
      axios.get(`${FMP_BASE}/stable/profile`, {
        params: { symbol, apikey: apiKey },
        timeout: 15000,
        validateStatus: () => true,
      }),
      expectedMoveService.getExpectedMove(symbol, null, 'research').catch(() => null),
    ]);

    if (quoteResp.status < 200 || quoteResp.status >= 300) {
      return res.status(502).json({ error: 'Failed to fetch quote', detail: `status ${quoteResp.status}` });
    }

    const quote = Array.isArray(quoteResp.data) ? quoteResp.data[0] : null;
    const profile = Array.isArray(profileResp.data) ? profileResp.data[0] : null;
    if (!quote) return res.status(404).json({ error: `No quote found for ${symbol}` });

    const price = toNum(quote.price);
    const volume = toNum(quote.volume);
    const avgVolume =
      toNum(quote.avgVolume) ??
      toNum(quote.avgVolume3m) ??
      toNum(quote.averageVolume) ??
      null;
    const rvol = Number.isFinite(volume) && Number.isFinite(avgVolume) && avgVolume > 0
      ? volume / avgVolume
      : null;
    const previousClose = toNum(quote.previousClose);
    const open = toNum(quote.open);
    const gapPercent = Number.isFinite(open) && Number.isFinite(previousClose) && previousClose !== 0
      ? ((open - previousClose) / previousClose) * 100
      : null;
    const bid = toNum(quote.bid);
    const ask = toNum(quote.ask);
    const spread = Number.isFinite(bid) && Number.isFinite(ask) ? ask - bid : null;

    return res.json({
      symbol,
      provider: 'fmp',
      price,
      change: toNum(quote.change),
      changePercent: toNum(quote.changePercentage) ?? toNum(quote.changesPercentage),
      volume,
      avgVolume,
      rvol,
      gapPercent,
      bid,
      ask,
      spread,
      marketCap: toNum(quote.marketCap),
      float: toNum(profile?.sharesOutstanding) ?? toNum(profile?.floatShares),
      sector: profile?.sector || null,
      industry: profile?.industry || null,
      expectedMove: expectedMove?.data
        ? {
            amount: toNum(expectedMove.data.impliedMoveDollar),
            percent: Number.isFinite(Number(expectedMove.data.impliedMovePct))
              ? Number(expectedMove.data.impliedMovePct) * 100
              : null,
          }
        : null,
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch quote', detail: err.message });
  }
});

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
