const express = require('express');

const { getMarketOverview, emptyOverview } = require('../services/marketOverviewService');

const router = express.Router();

router.get('/overview', async (_req, res) => {
  try {
    const data = await getMarketOverview();
    return res.json({
      status: data?.degraded ? 'degraded' : 'ok',
      data,
      meta: {
        fallback: false,
        partial: Boolean(data?.partial),
        reason: data?.degraded
          ? 'degraded_sections'
          : data?.partial
            ? 'partial_data'
            : null,
        degraded_sections: data?.meta?.degraded_sections || [],
        section_status: data?.meta?.section_status || {},
        table_metadata_error: data?.meta?.table_metadata_error || null,
      },
    });
  } catch (error) {
    return res.json({
      status: 'degraded',
      data: {
        ...emptyOverview(),
        degraded: true,
        error: error.message,
      },
      meta: {
        fallback: true,
        reason: 'no_data',
      },
    });
  }
});

module.exports = router;