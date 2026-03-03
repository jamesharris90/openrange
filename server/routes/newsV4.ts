// @ts-nocheck
const express = require('express');
const { getNewsForUniverse } = require('../services/newsEngineV2.ts');

const router = express.Router();

router.get('/news', async (req, res) => {
  try {
    const hoursBack = Number(req.query.hoursBack);
    const bucket = String(req.query.bucket || '').trim();
    const exchange = String(req.query.exchange || '').trim().toUpperCase();

    const data = await getNewsForUniverse(
      Number.isFinite(hoursBack) && hoursBack > 0 ? hoursBack : 24,
      {
        bucket,
        exchange,
      }
    );

    return res.json({
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('[newsV4] failed', {
      message: error?.message,
    });
    return res.status(500).json({
      error: 'NEWS_V4_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
});

module.exports = router;
