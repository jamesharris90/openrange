const express = require('express');
const { queryWithTimeout } = require('../db/pg');

const router = express.Router();

router.get('/performance', async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `select * from strategy_performance_summary`,
      [],
      { timeoutMs: 8000, label: 'api.calibration.performance', maxRetries: 0 }
    );

    return res.json({
      ok: true,
      items: Array.isArray(result?.rows) ? result.rows : [],
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to load calibration performance',
      detail: error.message,
      items: [],
    });
  }
});

module.exports = router;