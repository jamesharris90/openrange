const express = require('express');
const rateLimit = require('express-rate-limit');
const { fetchBatchQuotes } = require('../services/quotesBatchService');

const router = express.Router();

const quotesBatchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const MAX_SYMBOLS = 25;
const SYMBOL_PATTERN = /^[A-Z0-9.\-]+$/;

function decodeSymbolsInput(value) {
  let decoded = String(value || '');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function parseSymbolsQuery(rawSymbols) {
  const joined = Array.isArray(rawSymbols) ? rawSymbols.join(',') : rawSymbols;
  const decoded = decodeSymbolsInput(joined);

  const deduped = [];
  const seen = new Set();

  for (const token of String(decoded || '').split(',')) {
    const symbol = token.trim().toUpperCase();
    if (!symbol) continue;
    if (!SYMBOL_PATTERN.test(symbol)) {
      return { error: `Invalid symbol: ${symbol}` };
    }
    if (!seen.has(symbol)) {
      seen.add(symbol);
      deduped.push(symbol);
    }
  }

  if (!deduped.length) {
    return { error: 'symbols query parameter is required (comma-separated string)' };
  }

  if (deduped.length > MAX_SYMBOLS) {
    return { error: `max ${MAX_SYMBOLS} symbols allowed` };
  }

  return { symbols: deduped };
}

router.get('/api/quotes-batch', quotesBatchLimiter, async (req, res) => {
  const parsed = parseSymbolsQuery(req.query.symbols);
  if (parsed.error) {
    return res.status(400).json({ success: false, error: parsed.error });
  }

  const normalizedSymbols = parsed.symbols;

  const symbolsString = normalizedSymbols.join(',');

  try {
    const quotes = await fetchBatchQuotes(symbolsString);
    const quoteMap = {};

    normalizedSymbols.forEach((symbol) => {
      quoteMap[symbol] = {
        price: null,
        open: null,
        high: null,
        low: null,
        close: null,
        volume: null,
      };
    });

    quotes.forEach((quote) => {
      if (!quote?.symbol || !quoteMap[quote.symbol]) return;
      quoteMap[quote.symbol] = {
        price: quote.price ?? null,
        open: quote.open ?? null,
        high: quote.high ?? null,
        low: quote.low ?? null,
        close: quote.close ?? null,
        volume: quote.volume ?? null,
      };
    });

    return res.json({
      success: true,
      data: quoteMap,
    });
  } catch (error) {
    if (error.message === 'FMP_API_KEY missing') {
      return res.status(500).json({ success: false, error: 'FMP_API_KEY missing' });
    }
    return res.status(502).json({ success: false, error: 'Failed to fetch batch quotes', detail: error.message });
  }
});

module.exports = router;
