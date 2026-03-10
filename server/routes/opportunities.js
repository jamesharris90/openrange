const express = require('express');
const { getCachedValue, setCachedValue } = require('../utils/responseCache');
const { fetchUnifiedSignals } = require('../services/signalService');

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
    const rows = await fetchUnifiedSignals({ limit });

    const mapped = rows.map((row) => ({
      symbol: row.symbol,
      score: row.score,
      confidence: row.probability,
      gap: row.gap_percent,
      rvol: row.relative_volume,
      volume: row.volume,
      float: null,
      catalyst: row.catalyst,
      strategy: row.strategy,
      signal_explanation: '',
      rationale: '',
      updated_at: row.updated_at,
      atr_percent: null,
      class: row.class,
      sector: row.sector,
      catalyst_type: row.catalyst_type,
    }));

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
