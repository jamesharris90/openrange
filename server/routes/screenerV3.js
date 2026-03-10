/**
 * screenerV3.js
 *
 * GET /api/data/screener-v3
 *
 * Responds with the environment (SPY state), any filter adjustments,
 * and paginated screener results. Optionally applies SPY-adaptive
 * filter warping when adaptFilters=true is passed.
 *
 * Query params: all existing screener params PLUS:
 *   structures[]       - array of structure names to filter by (e.g. ORB,GapAndGo)
 *   minGrade           - minimum structure grade: A+, A, B, C
 *   minFloat           - minimum floatShares
 *   maxFloat           - maximum floatShares
 *   adaptFilters       - 'true' to enable SPY-adaptive threshold warping
 *   page               - 0-indexed page number (default 0)
 *   pageSize           - rows per page, max 100 (default 25)
 */

const express = require('express');

const router       = express.Router();
const requireFeature = require('../middleware/requireFeature');
const cacheManager   = require('../data-engine/cacheManager');
const { applyFilters, warpFilters } = require('../data-engine/filterEngine');
const { getSpyState } = require('../data-engine/spyStateEngine');
const { getEnrichedUniverse } = require('../services/marketDataEngineV1.ts');

const DELTA_TTL_MS = 10 * 60 * 1000;
const deltaStateByKey = new Map();

function stableFilterSignature(filters = {}) {
  const sorted = {};
  Object.keys(filters).sort().forEach((key) => {
    const val = filters[key];
    if (Array.isArray(val)) {
      sorted[key] = [...val].map(String).sort();
      return;
    }
    sorted[key] = val;
  });
  return JSON.stringify(sorted);
}

function pruneDeltaState() {
  const now = Date.now();
  for (const [key, node] of deltaStateByKey.entries()) {
    if (!node?.updatedAt || (now - node.updatedAt) > DELTA_TTL_MS) {
      deltaStateByKey.delete(key);
    }
  }
}

function computeDeltas(scopeKey, symbolSet) {
  pruneDeltaState();

  const prevNode = deltaStateByKey.get(scopeKey);
  const prevSet = prevNode?.symbols;

  let added = [];
  let dropped = [];

  if (prevSet instanceof Set) {
    added = Array.from(symbolSet).filter((symbol) => !prevSet.has(symbol));
    dropped = Array.from(prevSet).filter((symbol) => !symbolSet.has(symbol));
  }

  deltaStateByKey.set(scopeKey, {
    symbols: symbolSet,
    updatedAt: Date.now(),
  });

  return {
    added,
    dropped,
    currentCount: symbolSet.size,
    previousCount: prevSet instanceof Set ? prevSet.size : null,
  };
}

// ---------------------------------------------------------------------------
// Parse screenerV3 query into a filter payload
// ---------------------------------------------------------------------------

function parseFilters(query) {
  const {
    // Internal / pagination params — excluded from filter payload
    page: _page,
    pageSize: _pageSize,
    adaptFilters: _adapt,
    // Everything else becomes filter params
    ...rest
  } = query;

  const filters = { ...rest };

  // Normalise exchange string → uppercase
  if (filters.exchange) filters.exchange = String(filters.exchange).toUpperCase();

  // structures param: comma-separated OR array: ?structures=ORB,GapAndGo or ?structures[]=ORB
  if (filters.structures) {
    const raw = filters.structures;
    filters.allowedStructures = (Array.isArray(raw) ? raw : String(raw).split(',')).map((s) => s.trim()).filter(Boolean);
    delete filters.structures;
  }

  // minGrade → minStructureGrade
  if (filters.minGrade) {
    filters.minStructureGrade = String(filters.minGrade).trim();
    delete filters.minGrade;
  }

  // Coerce numeric filter values
  const numericFields = [
    'minPrice', 'maxPrice', 'minMarketCap', 'maxMarketCap',
    'minVolume', 'maxVolume', 'minChangePercent', 'maxChangePercent',
    'minRelativeVolume', 'maxRelativeVolume', 'minGapPercent', 'maxGapPercent',
    'minRsi14', 'maxRsi14', 'minDollarVolume', 'maxDollarVolume',
    'minAtrPercent', 'maxAtrPercent', 'minFloat', 'maxFloat',
  ];
  numericFields.forEach((k) => {
    if (filters[k] !== undefined && filters[k] !== '') {
      const n = Number(filters[k]);
      filters[k] = Number.isFinite(n) ? n : undefined;
    }
  });

  return filters;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.get('/screener-v3', requireFeature('full_screener'), async (req, res) => {
  try {
    const spyState   = getSpyState();
    const baseFilters = parseFilters(req.query);
    const adapt       = req.query.adaptFilters === 'true';

    const { warped, adjustments } = adapt
      ? warpFilters(baseFilters, spyState)
      : { warped: baseFilters, adjustments: [] };

    const dataset = await getEnrichedUniverse();
    const filtered = applyFilters(dataset, warped);
    const symbolSet = new Set(filtered.map((row) => row.symbol).filter(Boolean));
    const userScope = req.user?.id || req.user?.email || req.user?.username || 'api-key';
    const scopeKey = `${userScope}::${stableFilterSignature(warped)}`;
    const deltas = computeDeltas(scopeKey, symbolSet);

    const page     = Math.max(parseInt(req.query.page, 10) || 0, 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 25, 1), 100);
    const results  = filtered.slice(page * pageSize, (page + 1) * pageSize);

    res.json({
      environment:    spyState,
      filtersAdjusted: adjustments,
      results,
      total:    filtered.length,
      page,
      pageSize,
      deltas,
      lastUpdated: cacheManager.getLastUpdated('enrichedUniverse'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
