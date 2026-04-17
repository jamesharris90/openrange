const express = require('express');
const {
  getCachedNewsFeedPayload,
  getCachedSymbolNewsPayload,
} = require('../services/experienceSnapshotService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const directSymbol = String(req.query.symbol || req.query.symbols || '').trim();
    if (directSymbol) {
      const payload = await getCachedSymbolNewsPayload(directSymbol, req.query.limit);
      return res.json(payload);
    }
    const payload = await getCachedNewsFeedPayload(req.query || {});
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      data: [],
    });
  }
});

module.exports = router;