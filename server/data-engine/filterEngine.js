function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function matchNumeric(value, min, max) {
  const n = toNumber(value);
  if (n == null) return false;
  if (min != null && n < min) return false;
  if (max != null && n > max) return false;
  return true;
}

function matchBoolean(value, wanted) {
  if (wanted == null) return true;
  return Boolean(value) === Boolean(wanted);
}

function matchEnum(value, options) {
  if (!Array.isArray(options) || options.length === 0) return true;
  return options.map(String).includes(String(value));
}

function applyFilters(dataset, filters = {}) {
  const minMaxKeys = [
    ['price',          'minPrice',          'maxPrice'],
    ['marketCap',      'minMarketCap',      'maxMarketCap'],
    ['volume',         'minVolume',         'maxVolume'],
    ['changePercent',  'minChangePercent',  'maxChangePercent'],
    ['relativeVolume', 'minRelativeVolume', 'maxRelativeVolume'],
    ['gapPercent',     'minGapPercent',     'maxGapPercent'],
    ['rsi14',          'minRsi14',          'maxRsi14'],
    ['dollarVolume',   'minDollarVolume',   'maxDollarVolume'],
    ['newsCount24h',   'minNewsCount24h',   'maxNewsCount24h'],
    ['atrPercent',     'minAtrPercent',     'maxAtrPercent'],
    ['momentumScore',  'minMomentumScore',  'maxMomentumScore'],
    ['structureScore', 'minStructureScore', 'maxStructureScore'],
    ['liquidityScore', 'minLiquidityScore', 'maxLiquidityScore'],
    ['riskScore',      'minRiskScore',      'maxRiskScore'],
  ];

  return dataset.filter((row) => {
    for (const [field, minKey, maxKey] of minMaxKeys) {
      const hasMin = filters[minKey] !== undefined && filters[minKey] !== '';
      const hasMax = filters[maxKey] !== undefined && filters[maxKey] !== '';
      if (!hasMin && !hasMax) continue;
      const min = hasMin ? toNumber(filters[minKey]) : null;
      const max = hasMax ? toNumber(filters[maxKey]) : null;
      if (!matchNumeric(row[field], min, max)) return false;
    }

    if (!matchEnum(String(row.exchange || '').toUpperCase(), filters.exchanges || (filters.exchange ? [filters.exchange] : []))) return false;
    if (!matchEnum(row.sector, filters.sectors)) return false;
    if (!matchEnum(row.industry, filters.industries)) return false;

    if (!matchBoolean(row.hasRecentCatalyst, filters.hasRecentCatalyst)) return false;
    if (!matchBoolean(row.inPlayFlag, filters.inPlayFlag)) return false;
    if (!matchBoolean(row.highRvolFlag, filters.highRvolFlag)) return false;
    if (!matchBoolean(row.lowFloatFlag, filters.lowFloatFlag)) return false;

    if (filters.strategyFlags && Array.isArray(filters.strategyFlags) && filters.strategyFlags.length) {
      const ok = filters.strategyFlags.every((flagName) => {
        const node = row[flagName];
        if (node && typeof node === 'object' && 'flag' in node) return Boolean(node.flag);
        return Boolean(node);
      });
      if (!ok) return false;
    }

    // Structure filters (OpenRange Screener Engine v1)
    if (filters.allowedStructures && Array.isArray(filters.allowedStructures) && filters.allowedStructures.length) {
      if (!filters.allowedStructures.includes(row.structure)) return false;
    }

    if (filters.minStructureGrade) {
      const GRADE_ORDER = ['C', 'B', 'A', 'A+'];
      const rowGradeIdx = GRADE_ORDER.indexOf(row.structureGrade);
      const minGradeIdx = GRADE_ORDER.indexOf(filters.minStructureGrade);
      if (rowGradeIdx < 0 || rowGradeIdx < minGradeIdx) return false;
    }

    // Float filters
    if (filters.minFloat !== undefined && filters.minFloat !== '') {
      const min = toNumber(filters.minFloat);
      if (min != null && !matchNumeric(row.floatShares, min, null)) return false;
    }
    if (filters.maxFloat !== undefined && filters.maxFloat !== '') {
      const max = toNumber(filters.maxFloat);
      if (max != null && !matchNumeric(row.floatShares, null, max)) return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// SPY-adaptive filter warping
// ---------------------------------------------------------------------------

/**
 * Warp base filter thresholds based on current SPY state.
 * Returns { warped: filtersObject, adjustments: [{field, original, adjusted, reason}] }
 * This function is pure (no side effects) — spyState is passed in.
 *
 * @param {object} filters   - base filter object from user
 * @param {object} spyState  - from spyStateEngine.getSpyState()
 */
function warpFilters(filters = {}, spyState = {}) {
  const { bias = 0, vixDecile = 5 } = spyState;
  const warped = { ...filters };
  const adjustments = [];

  // High VIX → relax relative volume threshold (stocks move more, vol spikes are common)
  if (vixDecile >= 8 && warped.minRelativeVolume != null) {
    const orig = toNumber(warped.minRelativeVolume);
    if (orig != null && orig > 1.2) {
      const adjusted = Math.max(1.2, Math.round(orig * 0.8 * 100) / 100);
      warped.minRelativeVolume = adjusted;
      adjustments.push({ field: 'minRelativeVolume', original: orig, adjusted, reason: `VIX decile ${vixDecile} (elevated)` });
    }
  }

  // Strong bull day → allow lower gap threshold for trend/momentum setups
  if (bias >= 3 && warped.minGapPercent != null) {
    const orig = toNumber(warped.minGapPercent);
    if (orig != null && orig > 0) {
      const adjusted = Math.max(0, Math.round(orig * 0.8 * 100) / 100);
      warped.minGapPercent = adjusted;
      adjustments.push({ field: 'minGapPercent', original: orig, adjusted, reason: `SPY bias +${bias} (bull day)` });
    }
  }

  // Bear day → tighten upside change filter (be more selective on long side)
  if (bias <= -2 && warped.minChangePercent != null) {
    const orig = toNumber(warped.minChangePercent);
    if (orig != null && orig > 0) {
      const adjusted = Math.round(orig * 1.2 * 100) / 100;
      warped.minChangePercent = adjusted;
      adjustments.push({ field: 'minChangePercent', original: orig, adjusted, reason: `SPY bias ${bias} (bear day)` });
    }
  }

  return { warped, adjustments };
}

module.exports = {
  applyFilters,
  warpFilters,
};
