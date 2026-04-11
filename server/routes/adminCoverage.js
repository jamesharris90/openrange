const express = require('express');

const { requireAdminAccess } = require('../middleware/requireAdminAccess');
const {
  ensureCoverageStatusTable,
  getCoverageStatusBreakdown,
} = require('../services/dataCoverageStatusService');
const {
  ensureCoverageCampaignProgressTable,
  getLatestCoverageCampaignProgress,
} = require('../services/coverageCampaignProgressService');

const router = express.Router();

router.get('/coverage-status', requireAdminAccess, async (_req, res) => {
  try {
    await Promise.all([
      ensureCoverageStatusTable(),
      ensureCoverageCampaignProgressTable(),
    ]);

    const [statuses, progress] = await Promise.all([
      getCoverageStatusBreakdown(),
      getLatestCoverageCampaignProgress(),
    ]);

    const counts = (statuses || []).reduce((accumulator, row) => {
      const key = String(row.status || '').toUpperCase();
      if (key) {
        accumulator[key] = Number(row.count || 0);
      }
      return accumulator;
    }, {});

    const totalSymbols = Number(progress?.total_symbols || 0);
    const processedSymbols = Number(progress?.processed_symbols || 0);
    const progressPercent = totalSymbols > 0
      ? Number(((processedSymbols / totalSymbols) * 100).toFixed(2))
      : 0;

    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      statuses,
      counts,
      progress: progress
        ? {
            id: progress.id,
            total_symbols: totalSymbols,
            processed_symbols: processedSymbols,
            has_data: Number(progress.has_data || 0),
            unsupported: Number(progress.unsupported || 0),
            started_at: progress.started_at,
            updated_at: progress.updated_at,
            progress_percent: progressPercent,
          }
        : null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Failed to load coverage campaign status',
      statuses: [],
      counts: {},
      progress: null,
    });
  }
});

module.exports = router;