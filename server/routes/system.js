const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const cronLogPath = path.resolve(__dirname, '../logs/cron.log');

router.get('/cron-status', async (_req, res) => {
  try {
    if (!fs.existsSync(cronLogPath)) {
      return res.json({
        status: 'OK',
        recent_runs: [],
      });
    }

    const logs = fs.readFileSync(cronLogPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-50)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean);

    return res.json({
      status: 'OK',
      recent_runs: logs,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'ERROR',
      error: error.message,
    });
  }
});

module.exports = router;
