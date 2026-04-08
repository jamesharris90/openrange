const express = require('express');

const { buildChartPayload } = require('../services/chartService');

const router = express.Router();

router.get('/:symbol', async (req, res) => {
  try {
    const payload = await buildChartPayload(req.params.symbol);
    return res.json(payload);
  } catch (error) {
    const message = error?.message || 'chart_fetch_failed';
    const status = message === 'symbol_required' ? 400 : message === 'chart_data_unavailable' ? 404 : 502;

    return res.status(status).json({
      success: false,
      candles: [],
      timeframe: null,
      source: 'unavailable',
      error: message,
    });
  }
});

module.exports = router;