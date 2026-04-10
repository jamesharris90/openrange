const express = require('express');
const { getCachedValue, setCachedValue } = require('../utils/responseCache');
const { runOpportunityRanker } = require('../engines/opportunityRanker');
const { supabaseAdmin } = require('../services/supabaseClient');
const { getTopOpportunities } = require('../repositories/opportunityRepository');
const { buildTruthDecisionForSymbol } = require('../services/truthEngine');

const router = express.Router();

function isDbTimeoutError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === 'QUERY_TIMEOUT' || msg.includes('timeout');
}

async function mapOpportunityRows(rows) {
  return Promise.all((rows || []).map(async (row) => {
    const decision = await buildTruthDecisionForSymbol(row.symbol, {
      includeNarrative: true,
      allowRemoteNarrative: false,
    }).catch(() => ({
      symbol: row.symbol,
      tradeable: Number(row.score) >= 60,
      confidence: Number(row.score) || 0,
      setup: row.setup_type || 'NO_SETUP',
      bias: 'NEUTRAL',
      driver: 'STRATEGY_SETUP',
      earnings_edge: {
        label: 'NO_EDGE',
        score: 0,
        bias: 'NEUTRAL',
        next_date: null,
        report_time: null,
        expected_move_percent: null,
        status: 'none',
        read: null,
      },
      risk_flags: [],
      status: Number(row.score) >= 60 ? 'TRADEABLE' : 'AVOID',
      action: Number(row.score) >= 60 ? 'TRADEABLE' : 'AVOID',
      why: row.setup_type || 'Setup detected from authoritative opportunities table.',
      how: 'Wait for the setup to confirm before entering.',
      risk: 'Avoid forcing size without confirmation.',
      narrative: {
        why_this_matters: row.setup_type || 'A setup was detected, but deeper context was unavailable.',
        what_to_do: 'Wait for confirmation before acting.',
        what_to_avoid: 'Avoid trading without a confirmed trigger.',
        source: 'deterministic_fallback',
        locked: true,
      },
      execution_plan: null,
      source: 'truth_engine',
      why_moving: {
        driver: 'STRATEGY_SETUP',
        summary: row.setup_type || 'Setup detected from authoritative opportunities table.',
        tradeability: Number(row.score) >= 60 ? 'HIGH' : 'LOW',
        confidence_score: Number(row.score) || 0,
        bias: 'NEUTRAL',
        what_to_do: 'Wait for confirmation before acting.',
        what_to_avoid: 'Avoid trading without a confirmed trigger.',
        setup: row.setup_type || 'NO_SETUP',
        action: Number(row.score) >= 60 ? 'TRADE' : 'AVOID',
        trade_plan: null,
      },
    }));

    return {
      symbol: row.symbol,
      score: row.score,
      confidence: decision.confidence,
      gap: null,
      rvol: null,
      volume: null,
      float: null,
      catalyst: decision.driver.toLowerCase(),
      strategy: decision.setup,
      signal_explanation: decision.narrative?.why_this_matters || decision.why,
      rationale: decision.why,
      updated_at: row.updated_at,
      atr_percent: null,
      class: null,
      sector: null,
      catalyst_type: decision.driver,
      decision,
      why_moving: decision.why_moving,
    };
  }));
}

router.get('/opportunities/top', async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 100));
  const cacheKey = `api.opportunities.top:${limit}`;
  const cacheTtlMs = 15_000;
  const cached = getCachedValue(cacheKey);

  if (cached && (Date.now() - new Date(cached.timestamp || 0).getTime()) <= cacheTtlMs) {
    return res.json(cached);
  }

  try {
    const dbRows = await getTopOpportunities(supabaseAdmin, {
      limit,
      source: 'opportunity_ranker',
    });

    let mapped = await mapOpportunityRows(dbRows || []);

    if (!mapped.length) {
      await runOpportunityRanker();
      const fallbackRows = await getTopOpportunities(supabaseAdmin, {
        limit,
        source: 'opportunity_ranker',
      });

      mapped = await mapOpportunityRows(fallbackRows || []);
    }

    const payload = { success: true, degraded: false, items: mapped, data: mapped, timestamp: new Date().toISOString() };
    setCachedValue(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    if (isDbTimeoutError(error)) {
      return res.json({
        success: true,
        degraded: true,
        items: cached?.items || [],
        data: cached?.items || [],
        warning: 'OPPORTUNITIES_CACHE_FALLBACK',
        detail: error.message || 'Timeout loading top opportunities',
      });
    }

    return res.json({
      success: true,
      degraded: true,
      items: cached?.items || [],
      data: cached?.items || [],
      warning: 'OPPORTUNITIES_DEGRADED',
      detail: error.message || 'Failed to load top opportunities',
    });
  }
});

module.exports = router;
