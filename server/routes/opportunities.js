const express = require('express');
const { queryWithTimeout } = require('../db/pg');
const { getCachedValue, setCachedValue } = require('../utils/responseCache');

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
    const { rows } = await queryWithTimeout(
      `SELECT
        s.symbol,
        s.score,
        s.confidence,
        COALESCE(s.gap_percent, 0) AS gap,
        COALESCE(s.rvol, 0) AS rvol,
        COALESCE(m.volume, q.volume, 0) AS volume,
        COALESCE(m.float_shares, 0) AS float,
        COALESCE(c.headline, 'No catalyst') AS catalyst,
        s.strategy,
        COALESCE(s.signal_explanation, '') AS signal_explanation,
        COALESCE(s.rationale, '') AS rationale,
        s.updated_at,
        s.atr_percent
      FROM trade_signals s
      LEFT JOIN market_metrics m
        ON m.symbol = s.symbol
      LEFT JOIN market_quotes q ON q.symbol = s.symbol
      LEFT JOIN LATERAL (
        SELECT headline
        FROM trade_catalysts tc
        WHERE tc.symbol = s.symbol
        ORDER BY tc.published_at DESC NULLS LAST
        LIMIT 1
      ) c ON TRUE
      ORDER BY
        s.score DESC NULLS LAST
      LIMIT $1`,
      [limit],
      { label: 'routes.opportunities.top', timeoutMs: 1500, maxRetries: 0, retryDelayMs: 120 }
    );

    const payload = { success: true, degraded: false, items: rows, data: rows, timestamp: new Date().toISOString() };
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
