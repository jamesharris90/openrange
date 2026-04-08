const express = require('express');

const { getMarketOverview } = require('../services/marketOverviewService');

const router = express.Router();

router.get('/overview', async (_req, res) => {
  try {
    const data = await getMarketOverview();
    return res.json({
      status: data?.degraded ? 'degraded' : 'ok',
      data,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
});

module.exports = router;