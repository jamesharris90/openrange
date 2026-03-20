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

function sendNoData(res, payload) {
  return res.status(200).json({
    status: 'no_data',
    data: [],
    message: payload.message,
    source: 'none',
  });
}

function sendError(res, code, message) {
  return res.status(code).json({
    status: 'error',
    message,
    source: 'none',
  });
}

router.get('/api/quote', async (req, res) => {
  const symbol = String(req.query.symbol || req.query.t || '').trim().toUpperCase();
  if (!symbol) return sendError(res, 400, 'symbol required');

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return sendError(res, 500, 'FMP_API_KEY missing');

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
      return sendError(res, 502, `Failed to fetch quote (status ${quoteResp.status})`);
    }

    const quote = Array.isArray(quoteResp.data) ? quoteResp.data[0] : null;
    const profile = Array.isArray(profileResp.data) ? profileResp.data[0] : null;
    if (!quote) {
      console.warn('[API DATA FAILURE]', {
        route: req.path,
        symbol,
        missing: ['price'],
      });
      return sendNoData(res, {
        message: 'No valid price data',
      });
    }

    const quotedPrice = toNum(quote.price);
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
    const price = quotedPrice ?? previousClose ?? open;

    if (!price || price <= 0) {
      const ivCandidate = expectedMove?.data && Number.isFinite(Number(expectedMove.data.impliedMovePct))
        ? Number(expectedMove.data.impliedMovePct)
        : null;

      const missing = ['price'];
      if (!ivCandidate || ivCandidate <= 0) missing.push('iv');

      console.warn('[API DATA FAILURE]', {
        route: req.path,
        symbol,
        missing,
      });

      return sendNoData(res, {
        message: 'No valid price data',
      });
    }

    const gapPercent = Number.isFinite(open) && Number.isFinite(previousClose) && previousClose !== 0
      ? ((open - previousClose) / previousClose) * 100
      : null;
    const bid = toNum(quote.bid);
    const ask = toNum(quote.ask);
    const spread = Number.isFinite(bid) && Number.isFinite(ask) ? ask - bid : null;

    return res.json({
      status: 'ok',
      source: 'fmp',
      data: [{
      symbol,
      source: 'fmp',
      price,
      lastPrice: price,
      prevClose: previousClose,
      previousClose,
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
      iv: expectedMove?.data && Number.isFinite(Number(expectedMove.data.impliedMovePct))
        ? Number(expectedMove.data.impliedMovePct)
        : null,
      gex: null,
      openInterest: null,
      }],
    });
  } catch (err) {
    console.warn('[API DATA FAILURE]', {
      route: req.path,
      symbol,
      missing: ['price'],
      error: err.message,
    });
    return sendError(res, 502, 'Failed to fetch quote');
  }
});

router.get('/api/yahoo/quote-batch', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (!symbols.length) return sendError(res, 400, 'symbols required');
  try {
    const quotes = await market.getQuotes(symbols);
    if (!quotes || quotes.length === 0) {
      console.warn('[API DATA FAILURE]', {
        route: req.path,
        symbol: null,
        missing: ['price'],
      });
      return sendNoData(res, { message: 'No quote data available' });
    }

    return res.json({
      status: 'ok',
      data: quotes,
      source: 'none',
    });
  } catch (err) {
    return sendError(res, 502, 'Failed to fetch quotes');
  }
});

router.get('/api/yahoo/quote', async (req, res) => {
  const symbol = (req.query.symbol || req.query.t || '').trim().toUpperCase();
  if (!symbol) return sendError(res, 400, 'symbol required');
  try {
    const quotes = await market.getQuotes([symbol]);
    const quote = quotes[0] || null;
    if (!quote) {
      console.warn('[API DATA FAILURE]', {
        route: req.path,
        symbol,
        missing: ['price'],
      });
      return sendNoData(res, {
        symbol,
        message: 'No quote data available',
      });
    }
    return res.json({
      status: 'ok',
      data: [quote],
      source: 'none',
    });
  } catch (err) {
    return sendError(res, 502, 'Failed to fetch quote');
  }
});

router.get('/api/yahoo/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query || query.length < 2) return sendNoData(res, { message: 'No search query provided' });
  try {
    const results = await market.searchSymbols(query);
    if (!results || results.length === 0) {
      return sendNoData(res, { message: 'No symbol search results available' });
    }
    return res.json({
      status: 'ok',
      data: results,
      source: 'none',
    });
  } catch (err) {
    return sendError(res, 502, 'Failed to search symbols');
  }
});

module.exports = router;
