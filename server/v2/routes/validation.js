const express = require('express');

const { runEarningsValidation, runScreenerValidation } = require('../services/validationService');

const router = express.Router();

function getSymbols(req) {
  return String(req.query.symbols || '')
    .split(',')
    .map((item) => String(item || '').trim().toUpperCase())
    .filter(Boolean);
}

router.get('/screener', async (req, res) => {
  try {
    const payload = await runScreenerValidation({
      limit: req.query.limit,
      symbols: getSymbols(req),
    });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message, summary: null, rows: [] });
  }
});

router.get('/earnings', async (req, res) => {
  try {
    const payload = await runEarningsValidation({
      limit: req.query.limit,
      symbols: getSymbols(req),
    });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message, summary: null, rows: [] });
  }
});

module.exports = router;