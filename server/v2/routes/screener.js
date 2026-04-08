const express = require('express');
const { getLatestScreenerPayload } = require('../services/snapshotService');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const payload = await getLatestScreenerPayload();
    const rawUniverseSize = Number(payload?.meta?.raw_universe_size || 0);
    if (rawUniverseSize > 0) {
      console.log('[SCREENER_ROUTE] Universe size:', rawUniverseSize);
    }
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;