const express = require('express');
const { SIGNALS } = require('../../beacon-v0/orchestrator/run');
const { getLatestPicks } = require('../../beacon-v0/persistence/picks');

const router = express.Router();

const forwardLookingMap = new Map();
SIGNALS.forEach((signal) => {
  if (signal && signal.SIGNAL_NAME) {
    forwardLookingMap.set(signal.SIGNAL_NAME, Boolean(signal.FORWARD_LOOKING));
  }
});

function enrichPickDirectionCounts(pick) {
  const signalsAligned = Array.isArray(pick.signals_aligned) ? pick.signals_aligned : [];
  const forwardCount = signalsAligned.filter((signalName) => forwardLookingMap.get(signalName) === true).length;

  return {
    ...pick,
    forward_count: forwardCount,
    backward_count: signalsAligned.length - forwardCount,
  };
}

router.get('/picks', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const picks = (await getLatestPicks(limit)).map(enrichPickDirectionCounts);

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