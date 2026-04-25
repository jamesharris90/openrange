const express = require('express');
const { getLatestPicks } = require('../../beacon-v0/persistence/picks');

const router = express.Router();

router.get('/picks', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const picks = await getLatestPicks(limit);

    return res.json({
      picks,
      count: picks.length,
      version: 'v0',
      generated_at: picks[0]?.created_at || null,
      run_id: picks[0]?.run_id || null,
    });
  } catch (error) {
    console.error('beacon_v0_picks_failed:', error.message);
    return res.status(500).json({
      error: 'beacon_v0_picks_failed',
      message: error.message,
    });
  }
});

module.exports = router;