const express = require('express');

const { getCache, setCache } = require('../cache/memoryCache');
const { getScreenerRows } = require('../services/screenerService');
const { buildNarrative } = require('../services/narrativeService');

const router = express.Router();

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

router.get('/:symbol', async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: 'Symbol is required',
      });
    }

    const cachedScreener = getCache('screener');
    const screenerPayload = cachedScreener || (() => {
      return null;
    })();

    let rows;
    if (screenerPayload?.success && Array.isArray(screenerPayload.data)) {
      rows = screenerPayload.data;
    } else {
      const screenerResult = await getScreenerRows();
      const payload = {
        success: true,
        count: screenerResult.rows.length,
        fallbackUsed: screenerResult.fallbackUsed,
        data: screenerResult.rows,
      };
      setCache('screener', payload, 60000);
      rows = screenerResult.rows;
    }

    const screenerRow = rows.find((row) => normalizeSymbol(row?.symbol) === symbol);
    if (!screenerRow) {
      return res.status(404).json({
        success: false,
        error: `No screener row found for ${symbol}`,
      });
    }

    const narrative = await buildNarrative(symbol, screenerRow);
    return res.json({
      success: true,
      data: {
        symbol,
        screener: screenerRow,
        narrative,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;