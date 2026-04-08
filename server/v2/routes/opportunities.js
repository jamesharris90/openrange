const express = require('express');

const { getLatestOpportunitiesPayload } = require('../services/snapshotService');
const { getMarketState } = require('../../engines/marketStateEngine');
const { buildNextSessionPayload } = require('../../engines/nextSessionEngine');

const router = express.Router();

function toRouteOptions(req) {
  return {
    asOf: req.query.as_of || req.query.asOf || null,
    sessionOverride: req.query.session_override || req.query.sessionOverride || null,
  };
}

router.get('/', async (_req, res) => {
  try {
    const payload = await getLatestOpportunitiesPayload();
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.get('/next-session', async (req, res) => {
  const startedAt = Date.now();

  try {
    const options = toRouteOptions(req);
    const market = await getMarketState(options);

    if (market.is_market_open) {
      const payload = await getLatestOpportunitiesPayload();
      return res.json({
        success: true,
        status: 'ok',
        source: 'opportunities_live',
        market,
        mode: 'LIVE',
        data: payload,
        meta: {
          total_ms: Date.now() - startedAt,
        },
      });
    }

    const payload = await buildNextSessionPayload(options);
    return res.json({
      success: true,
      status: payload.message ? 'no_data' : 'ok',
      source: 'opportunities_next_session',
      market,
      mode: 'NEXT_SESSION',
      data: payload,
      meta: {
        total_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 'error',
      source: 'opportunities_next_session',
      error: error.message,
      data: {
        earnings: [],
        catalysts: [],
        momentum: [],
        generated_at: new Date().toISOString(),
        message: 'No qualifying setups identified for next session',
        missing_sources: ['route_failure'],
      },
    });
  }
});

module.exports = router;