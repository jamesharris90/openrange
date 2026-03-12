const express = require('express');
const { queryWithTimeout } = require('../db/pg');

const router = express.Router();

router.get('/watchdog', async (_req, res) => {
  try {
    const result = await queryWithTimeout(
      `select * from platform_watchdog_status limit 1`,
      [],
      { timeoutMs: 5000, maxRetries: 0, label: 'api.system.watchdog' }
    );

    return res.json({
      ok: true,
      watchdog: result?.rows?.[0] || null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to load watchdog status',
      detail: error.message,
      watchdog: null,
    });
  }
});

module.exports = router;
