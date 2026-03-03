const express = require('express');
const optionsService = require('../services/options/optionsService');
const expectedMoveService = require('../services/expectedMoveService');

const router = express.Router();

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

router.get('/atm/:symbol', async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol || !/^[A-Z0-9.^-]{1,10}$/.test(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol' });
    }

    const data = await optionsService.getATMContract(symbol);
    return res.json({ symbol, data });
  } catch (error) {
    return res.status(502).json({ error: 'Failed to fetch ATM contract', detail: error.message });
  }
});

router.get('/expected-move/:symbol', async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    const earningsDate = req.query.earnings ? String(req.query.earnings) : null;

    if (!symbol || !/^[A-Z0-9.^-]{1,10}$/.test(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol' });
    }

    if (req.query.earnings && Number.isNaN(new Date(earningsDate).getTime())) {
      return res.status(400).json({ error: 'Invalid earnings date. Use YYYY-MM-DD' });
    }

    const result = await expectedMoveService.getExpectedMove(symbol, earningsDate, 'research');
    return res.json({
      symbol,
      earningsDate: req.query.earnings || null,
      source: result.source || null,
      reason: result.reason || null,
      data: result.data,
    });
  } catch (error) {
    return res.status(502).json({ error: 'Failed to fetch expected move', detail: error.message });
  }
});

router.get('/cache/:symbol', (req, res) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol || !/^[A-Z0-9.^-]{1,10}$/.test(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol' });
    }

    const data = optionsService.getLatestCacheBySymbol(symbol);
    return res.json({ symbol, data });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to read cache', detail: error.message });
  }
});

module.exports = router;