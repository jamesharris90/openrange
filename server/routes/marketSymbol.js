const express = require('express');
const {
  fetchSymbolIntraday,
  getPrimaryIntradayHistory,
} = require('../services/symbolIntradayService');

const router = express.Router();

function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,10}$/.test(symbol)) return '';
  return symbol;
}

router.get('/api/market/symbol/:symbol', async (req, res) => {
  const symbol = normalizeSymbol(req.params.symbol);
  if (!symbol) {
    return res.status(400).json({ ok: false, error: 'Invalid symbol' });
  }

  try {
    const existingRows = await getPrimaryIntradayHistory(symbol, Number(req.query.limit) || 1000);
    if (existingRows.length > 0) {
      return res.json({
        ok: true,
        symbol,
        source: 'intraday_1m',
        items: existingRows,
      });
    }

    const fetched = await fetchSymbolIntraday(symbol);
    return res.json({
      ok: true,
      symbol,
      source: fetched.source,
      items: fetched.rows,
    });
  } catch (error) {
    const message = String(error?.message || 'Failed to fetch symbol data');
    if (message.includes('table missing')) {
      return res.status(503).json({ ok: false, error: message });
    }
    return res.status(500).json({ ok: false, error: message });
  }
});

module.exports = router;
