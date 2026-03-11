const express = require('express');
const { getCachedValue, setCachedValue } = require('../utils/responseCache');
const { queryWithTimeout } = require('../db/pg');
const { runOpportunityRanker } = require('../engines/opportunityRanker');

const router = express.Router();

function isDbTimeoutError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === 'QUERY_TIMEOUT' || msg.includes('timeout');
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
    const dbRows = await queryWithTimeout(
      `WITH ranked AS (
         SELECT
           os.symbol,
           os.score,
           os.headline,
           os.created_at,
           ROW_NUMBER() OVER (
             PARTITION BY os.symbol
             ORDER BY os.created_at DESC
           ) AS rank_per_symbol
         FROM opportunity_stream os
         WHERE os.source = 'opportunity_ranker'
       )
       SELECT symbol, score, headline, created_at
       FROM ranked
       WHERE rank_per_symbol = 1
       ORDER BY score DESC NULLS LAST, created_at DESC
       LIMIT $1`,
      [limit],
      { timeoutMs: 2200, label: 'api.opportunities.top.ranked', maxRetries: 0 }
    );

    let mapped = (dbRows.rows || []).map((row) => ({
      symbol: row.symbol,
      score: row.score,
      confidence: row.score,
      gap: null,
      rvol: null,
      volume: null,
      float: null,
      catalyst: row.headline,
      strategy: 'Ranked Opportunity',
      signal_explanation: row.headline,
      rationale: row.headline,
      updated_at: row.created_at,
      atr_percent: null,
      class: null,
      sector: null,
      catalyst_type: null,
    }));

    if (!mapped.length) {
      await runOpportunityRanker();
      const fallbackRows = await queryWithTimeout(
        `SELECT symbol, score, headline, created_at
         FROM opportunity_stream
         WHERE source = 'opportunity_ranker'
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit],
        { timeoutMs: 2200, label: 'api.opportunities.top.ranked_fallback', maxRetries: 0 }
      );

      mapped = (fallbackRows.rows || []).map((row) => ({
        symbol: row.symbol,
        score: row.score,
        confidence: row.score,
        gap: null,
        rvol: null,
        volume: null,
        float: null,
        catalyst: row.headline,
        strategy: 'Ranked Opportunity',
        signal_explanation: row.headline,
        rationale: row.headline,
        updated_at: row.created_at,
        atr_percent: null,
        class: null,
        sector: null,
        catalyst_type: null,
      }));
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
