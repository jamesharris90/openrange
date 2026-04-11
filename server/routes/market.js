const express = require('express');

const { getMarketOverview, emptyOverview } = require('../services/marketOverviewService');

const router = express.Router();

function withTimeout(promise, timeoutMs, fallbackValue) {
  const ms = Number(timeoutMs) || 1800;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallbackValue), ms);
    }),
  ]);
}

router.get('/overview', async (_req, res) => {
  try {
    const data = await withTimeout(
      getMarketOverview(),
      1800,
      {
        ...emptyOverview(),
        degraded: true,
        source: 'timeout_fallback',
      }
    );
    return res.json({
      status: data?.degraded ? 'degraded' : 'ok',
      data,
      meta: data?.degraded
        ? { fallback: true, reason: 'timeout' }
        : { fallback: false },
    });
  } catch (error) {
    return res.json({
      status: 'degraded',
      data: {
        ...emptyOverview(),
        degraded: true,
        error: error.message,
      },
      meta: {
        fallback: true,
        reason: 'no_data',
      },
    });
  }
});

module.exports = router;