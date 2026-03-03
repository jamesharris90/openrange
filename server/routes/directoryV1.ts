// @ts-nocheck
const express = require('express');
const { getDirectorySummary } = require('../services/directoryServiceV1.ts');

const router = express.Router();

router.get('/summary', async (_req, res) => {
  try {
    const summary = await getDirectorySummary();
    return res.json(summary);
  } catch (error) {
    console.error('[directoryV1] fatal summary error', {
      message: error?.message,
    });
    return res.status(500).json({
      error: 'DIRECTORY_V1_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
});

module.exports = router;
