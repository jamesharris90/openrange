const express = require('express');

const { buildAndStoreScreenerSnapshot } = require('../services/snapshotService');

const router = express.Router();

router.post('/seed-snapshot', async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      error: 'DEV_ONLY_ENDPOINT',
    });
  }

  try {
    const snapshot = await buildAndStoreScreenerSnapshot();
    if (!snapshot) {
      return res.status(503).json({
        success: false,
        error: 'SNAPSHOT_NOT_WRITTEN',
      });
    }

    return res.json({
      success: true,
      snapshot_id: snapshot.id,
      snapshot_at: snapshot.created_at,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;