const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const cacheManager = require('../data-engine/cacheManager');
const { getCurrentPhaseInfo } = require('../scheduler/phaseScheduler');
const { getApiMetrics } = require('../services/quoteService');
const { refreshLayerA } = require('../services/enrichmentPipeline');

router.get('/status', authMiddleware, async (req, res) => {
  try {
    const phaseInfo  = getCurrentPhaseInfo();
    const apiMetrics = getApiMetrics();

    const fullUniverse         = cacheManager.getBaseUniverse();
    const enrichedUniverse     = cacheManager.getEnrichedUniverse();
    const operationalUniverse  = cacheManager.getDataset('operationalUniverse') || [];
    const quoteCache           = cacheManager.getDataset('quotes') || new Map();
    const sharedMetrics        = cacheManager.getApiMetrics();

    res.json({
      // Universe counts
      fullUniverseCount:        fullUniverse.length,
      enrichedCount:            enrichedUniverse.length,
      operationalUniverseCount: Array.isArray(operationalUniverse) ? operationalUniverse.length : 0,
      quotesCached:             quoteCache instanceof Map ? quoteCache.size : 0,
      watchlistCount:           phaseInfo.watchlistCount,

      // Active configuration
      activePresetName:    phaseInfo.activePresetName || null,
      currentRefreshPhase: phaseInfo.currentPhase,
      phaseIntervals:      phaseInfo.intervals,

      // Refresh timestamps
      lastFullRebuild:        phaseInfo.lastFullRebuild,
      lastFundamentalsRun:    phaseInfo.lastFundamentalsRun,
      lastOperationalRefresh: phaseInfo.lastOperationalRefresh,
      lastWatchlistRefresh:   phaseInfo.lastWatchlistRefresh,
      lastNewsRun:            phaseInfo.lastNewsRun,
      lastTier3Refresh:       phaseInfo.lastTier3Refresh,

      // In-flight status
      tier2InFlight: phaseInfo.tier2InFlight,
      tier3InFlight: phaseInfo.tier3InFlight,

      // API call budget
      apiCallsLastMinuteEstimate: sharedMetrics.callsThisWindow,
      apiCallsTotal:              apiMetrics.totalCalls,
      apiCallErrors:              apiMetrics.totalErrors,
      lastRefreshDurationMs:      apiMetrics.lastRefreshDurationMs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system/trigger-layer-a — force Layer A rebuild (admin / dev recovery)
router.post('/trigger-layer-a', authMiddleware, async (req, res) => {
  res.json({ ok: true, message: 'Layer A rebuild triggered in background' });
  refreshLayerA(console).then(() => {
    console.log('Manual Layer A complete, universe:', cacheManager.getBaseUniverse().length);
  }).catch(err => {
    console.error('Manual Layer A failed:', err.message);
  });
});

module.exports = router;
