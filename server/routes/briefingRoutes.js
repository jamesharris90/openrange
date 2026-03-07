const express = require('express');
const router = express.Router();
const { queryWithTimeout } = require('../db/pg');

router.get('/latest', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT to_jsonb(b) AS briefing
       FROM morning_briefings b
       ORDER BY b.created_at DESC
       LIMIT 1`,
      [],
      { timeoutMs: 7000, label: 'api.briefing.latest', maxRetries: 0 }
    );

    if (!rows.length) {
      return res.json({
        success: true,
        briefing: null,
        message: 'No briefing available yet',
      });
    }

    res.json({
      success: true,
      briefing: rows[0].briefing,
    });
  } catch (error) {
    if (error?.code === '42P01') {
      return res.json({
        success: true,
        briefing: null,
        message: 'Briefing table is not available yet',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to load latest briefing',
      detail: error.message,
    });
  }
});

module.exports = router;
