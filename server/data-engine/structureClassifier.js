/**
 * structureClassifier.js
 *
 * Deterministic 12-structure classifier for the OpenRange Screener Engine.
 *
 * Each row in the enriched universe is evaluated against 12 structure
 * definitions (requirements + invalidations). The first matching structure
 * in priority order is assigned — ensuring mutual exclusivity.
 *
 * Grade rules (universal):
 *   A+ — relVol ≥ 4 AND hasRecentCatalyst AND (lowFloatFlag OR atrPct ≥ 3)
 *   A  — relVol ≥ 2.5 AND atrPct ≥ 2
 *   B  — relVol ≥ 1.5
 *   C  — base requirements pass only
 */

// ---------------------------------------------------------------------------
// Grade logic
// ---------------------------------------------------------------------------

const GRADE_ORDER = ['A+', 'A', 'B', 'C'];

function computeGrade(row) {
  const relVol  = row.relativeVolume ?? 0;
  const atrPct  = row.atrPercent     ?? 0;
  const catalyst = !!row.hasRecentCatalyst;
  const lowFloat = !!row.lowFloatFlag;

  if (relVol >= 4 && catalyst && (lowFloat || atrPct >= 3)) return 'A+';
  if (relVol >= 2.5 && atrPct >= 2)                         return 'A';
  if (relVol >= 1.5)                                         return 'B';
  return 'C';
}

function gradeScore(grade) {
  return { 'A+': 100, A: 80, B: 60, C: 40 }[grade] ?? 0;
}

// ---------------------------------------------------------------------------
// Structure definitions
// ---------------------------------------------------------------------------
// Each definition has:
//   name        — canonical identifier
//   label       — display-friendly name
//   side        — 'bullish' | 'bearish' | 'neutral'
//   requirements — array of { id, check(row): boolean, label }
//   invalidations — array of { id, check(row): boolean, label }
// ---------------------------------------------------------------------------

const STRUCTURES = [
  // 1. ORB (Opening Range Breakout)
  {
    name: 'ORB',
    label: 'Opening Range Breakout',
    side: 'bullish',
    requirements: [
      { id: 'orbPresent',   label: 'ORB flag set',           check: (r) => !!r.orbPresent },
      { id: 'relVol',       label: 'Rel vol ≥ 2',            check: (r) => (r.relativeVolume ?? 0) >= 2 },
      { id: 'aboveOR',      label: 'Price > opening range H', check: (r) => r.openingRangeHigh != null ? r.price > r.openingRangeHigh : !!r.orbPresent },
      { id: 'atrPct',       label: 'ATR% > 1',               check: (r) => (r.atrPercent ?? 0) > 1 },
    ],
    invalidations: [
      { id: 'blowOff',  label: 'Gap > 15% (blow-off)',   check: (r) => (r.gapPercent ?? 0) > 15 },
      { id: 'lowVol',   label: 'Volume < 200k',           check: (r) => (r.volume ?? 0) < 200_000 },
    ],
  },

  // 2. Gap & Go
  {
    name: 'GapAndGo',
    label: 'Gap & Go',
    side: 'bullish',
    requirements: [
      { id: 'gapPct',        label: 'Gap ≥ 5%',               check: (r) => (r.gapPercent ?? 0) >= 5 },
      { id: 'relVol',        label: 'Rel vol ≥ 3',            check: (r) => (r.relativeVolume ?? 0) >= 3 },
      { id: 'pmHighBreak',   label: 'Premarket high break',   check: (r) => !!r.premarketHighBreak },
      { id: 'aboveOpen',     label: 'Price > open',           check: (r) => r.open != null ? r.price > r.open : true },
    ],
    invalidations: [
      { id: 'gapDown',  label: 'Gap is negative',     check: (r) => (r.gapPercent ?? 0) < 0 },
      { id: 'lowVol',   label: 'Volume < 300k',        check: (r) => (r.volume ?? 0) < 300_000 },
    ],
  },

  // 3. Trend Day
  {
    name: 'TrendDay',
    label: 'Trend Day',
    side: 'bullish',
    requirements: [
      { id: 'trendFlag',    label: 'Trend day HHHL flag',     check: (r) => !!r.trendDayHHHL },
      { id: 'aboveVwap',   label: 'Price above VWAP',        check: (r) => r.aboveVwap !== false },
      { id: 'return1D',    label: 'Day gain > 3%',           check: (r) => (r.return1D ?? 0) > 3 },
      { id: 'atrPct',      label: 'ATR% > 2',               check: (r) => (r.atrPercent ?? 0) > 2 },
    ],
    invalidations: [
      { id: 'negIntraday', label: 'Intraday move < 0%',   check: (r) => (r.intradayMoveFromOpenPercent ?? 0) < 0 },
      { id: 'lowRsi',      label: 'RSI < 50',              check: (r) => r.rsi14 != null && r.rsi14 < 50 },
    ],
  },

  // 4. VWAP Reclaim
  {
    name: 'VWAPReclaim',
    label: 'VWAP Reclaim',
    side: 'bullish',
    requirements: [
      { id: 'vwapReclaim',   label: 'VWAP reclaim flag',      check: (r) => !!r.vwapReclaim },
      { id: 'aboveVwap',     label: 'Price above VWAP',       check: (r) => r.aboveVwap !== false },
      { id: 'vwapDistClose', label: 'VWAP distance < 2%',    check: (r) => r.vwapDistancePercent != null ? Math.abs(r.vwapDistancePercent) < 2 : true },
      { id: 'relVol',        label: 'Rel vol ≥ 1.5',         check: (r) => (r.relativeVolume ?? 0) >= 1.5 },
    ],
    invalidations: [
      { id: 'bigGapDown', label: 'Gap down > 5%',       check: (r) => (r.gapPercent ?? 0) < -5 },
      { id: 'tinyMkt',    label: 'Market cap < $50M',   check: (r) => r.marketCap != null && r.marketCap < 50_000_000 },
    ],
  },

  // 5. Micro Pullback
  {
    name: 'MicroPullback',
    label: 'Micro Pullback',
    side: 'bullish',
    requirements: [
      { id: 'pullbackFlag', label: 'Micro pullback flag',   check: (r) => !!r.microPullbackContinuation },
      { id: 'aboveVwap',   label: 'Price above VWAP',      check: (r) => r.aboveVwap !== false },
      { id: 'rsiRange',    label: 'RSI 40–70',             check: (r) => r.rsi14 != null ? r.rsi14 >= 40 && r.rsi14 <= 70 : true },
      { id: 'relVol',      label: 'Rel vol ≥ 1.5',        check: (r) => (r.relativeVolume ?? 0) >= 1.5 },
    ],
    invalidations: [
      { id: 'overbought',  label: 'RSI > 80',                          check: (r) => r.rsi14 != null && r.rsi14 > 80 },
      { id: 'weakIntraday', label: 'Intraday move from open < -2%',   check: (r) => (r.intradayMoveFromOpenPercent ?? 0) < -2 },
    ],
  },

  // 6. Liquidity Sweep
  {
    name: 'LiquiditySweep',
    label: 'Liquidity Sweep',
    side: 'bullish',
    requirements: [
      { id: 'sweepFlag',  label: 'PDH/PDL sweep flag',         check: (r) => !!r.pdhPdlLiquiditySweep },
      { id: 'fromHigh',   label: 'Intraday drop from high > 2%', check: (r) => (r.intradayMoveFromHighPercent ?? 0) < -2 },
      { id: 'relVol',     label: 'Rel vol ≥ 2',               check: (r) => (r.relativeVolume ?? 0) >= 2 },
    ],
    invalidations: [
      { id: 'belowVwap',  label: 'Price below VWAP',        check: (r) => r.aboveVwap === false },
      { id: 'tinyMkt',    label: 'Market cap < $50M',       check: (r) => r.marketCap != null && r.marketCap < 50_000_000 },
    ],
  },

  // 7. Compression Breakout
  {
    name: 'CompressionBreakout',
    label: 'Compression Breakout',
    side: 'bullish',
    requirements: [
      { id: 'emaCompr',   label: 'EMA compression squeeze',  check: (r) => !!r.emaCompressionSqueeze },
      { id: 'volExpand',  label: 'Volume expansion breakout', check: (r) => !!r.volExpansionBreakout },
      { id: 'atrPct',     label: 'ATR% > 1.5',              check: (r) => (r.atrPercent ?? 0) > 1.5 },
    ],
    invalidations: [
      { id: 'notCompr',   label: 'EMA compression score > 1.2', check: (r) => r.emaCompressionScore != null && r.emaCompressionScore > 1.2 },
      { id: 'lowRelVol',  label: 'Rel vol < 1.5',               check: (r) => (r.relativeVolume ?? 0) < 1.5 },
    ],
  },

  // 8. Breakdown
  {
    name: 'Breakdown',
    label: 'Breakdown',
    side: 'bearish',
    requirements: [
      { id: 'bdownFlag',  label: 'Lower high breakdown flag',  check: (r) => !!r.lowerHighBreakdown },
      { id: 'belowVwap',  label: 'Price below VWAP',           check: (r) => r.aboveVwap === false },
      { id: 'relVol',     label: 'Rel vol ≥ 1.5',             check: (r) => (r.relativeVolume ?? 0) >= 1.5 },
    ],
    invalidations: [
      { id: 'gapUp',  label: 'Gap > 5%',    check: (r) => (r.gapPercent ?? 0) > 5 },
      { id: 'highRsi', label: 'RSI > 60',   check: (r) => r.rsi14 != null && r.rsi14 > 60 },
    ],
  },

  // 9. Mean Reversion
  {
    name: 'MeanReversion',
    label: 'Mean Reversion',
    side: 'bullish',
    requirements: [
      { id: 'oversold',    label: 'RSI < 30',                    check: (r) => r.rsi14 != null ? r.rsi14 < 30 : false },
      { id: 'near52wLow',  label: 'Within 10% of 52-week low',  check: (r) => r.distanceFrom52wLowPercent != null ? r.distanceFrom52wLowPercent < 10 : false },
      { id: 'relVol',      label: 'Rel vol ≥ 2',                check: (r) => (r.relativeVolume ?? 0) >= 2 },
    ],
    invalidations: [
      { id: 'deepDown',    label: '5D return < -30%',     check: (r) => r.return5D != null && r.return5D < -30 },
      { id: 'noCatalyst',  label: 'No recent catalyst',   check: (r) => r.hasRecentCatalyst === false },
    ],
  },

  // 10. Squeeze
  {
    name: 'Squeeze',
    label: 'Squeeze',
    side: 'neutral',
    requirements: [
      { id: 'emaCompr',  label: 'EMA compression squeeze',       check: (r) => !!r.emaCompressionSqueeze },
      { id: 'comprScore', label: 'EMA compression score < 0.8', check: (r) => r.emaCompressionScore != null ? r.emaCompressionScore < 0.8 : true },
      { id: 'buildingVol', label: 'Rel vol 0.5–1.5 (building)', check: (r) => { const rv = r.relativeVolume ?? 0; return rv >= 0.5 && rv <= 1.5; } },
    ],
    invalidations: [
      { id: 'alreadyBreaking', label: 'ATR% > 2 (already breaking out)', check: (r) => (r.atrPercent ?? 0) > 2 },
    ],
  },

  // 11. Drift
  {
    name: 'Drift',
    label: 'Drift',
    side: 'bullish',
    requirements: [
      { id: 'aboveVwap',  label: 'Price above VWAP',          check: (r) => r.aboveVwap !== false },
      { id: 'driftRange', label: 'Day gain 0.3–2%',           check: (r) => { const r1d = r.return1D ?? 0; return r1d >= 0.3 && r1d <= 2; } },
      { id: 'normalVol',  label: 'Rel vol 0.8–1.5 (quiet)',  check: (r) => { const rv = r.relativeVolume ?? 1; return rv >= 0.8 && rv <= 1.5; } },
      { id: 'lowAtr',     label: 'ATR% < 2 (controlled)',    check: (r) => (r.atrPercent ?? 99) < 2 },
    ],
    invalidations: [
      { id: 'catalyst',  label: 'Has recent catalyst',   check: (r) => !!r.hasRecentCatalyst },
      { id: 'highAtr',   label: 'ATR% > 3',              check: (r) => (r.atrPercent ?? 0) > 3 },
    ],
  },

  // 12. Reversal Base
  {
    name: 'ReversalBase',
    label: 'Reversal Base',
    side: 'bullish',
    requirements: [
      {
        id: 'reversalSignal',
        label: 'Red-to-green OR deeply oversold (RSI < 25)',
        check: (r) => !!r.redToGreen || (r.rsi14 != null && r.rsi14 < 25),
      },
      { id: 'relVol',     label: 'Rel vol ≥ 2',                      check: (r) => (r.relativeVolume ?? 0) >= 2 },
      { id: 'holdingPrev', label: 'Price > 98% of prev close',       check: (r) => r.previousClose ? r.price >= r.previousClose * 0.98 : true },
    ],
    invalidations: [
      { id: 'deepdown',   label: '5D return < -25%',     check: (r) => r.return5D != null && r.return5D < -25 },
      { id: 'belowVwap',  label: 'Price still below VWAP', check: (r) => r.aboveVwap === false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Evaluate a single row against all 12 structures.
 * Returns the first matching structure result, or null-filled if none match.
 */
function classifyRow(row) {
  for (const def of STRUCTURES) {
    // Check invalidations first (fast-fail)
    const invalidated = def.invalidations.find((inv) => {
      try { return inv.check(row); } catch { return false; }
    });
    if (invalidated) continue;

    // Check all requirements
    const matched   = [];
    const unmatched = [];
    for (const req of def.requirements) {
      let passes = false;
      try { passes = req.check(row); } catch { passes = false; }
      (passes ? matched : unmatched).push(req.label);
    }

    if (unmatched.length > 0) continue; // not all requirements met

    const grade = computeGrade(row);

    return {
      structure:            def.name,
      structureLabel:       def.label,
      structureSide:        def.side,
      grade,
      score:                gradeScore(grade),
      explanation:          `${def.label}: ${matched.slice(0, 3).join(', ')}`,
      matchedRequirements:  matched,
    };
  }

  return {
    structure:           null,
    structureLabel:      null,
    structureSide:       null,
    grade:               null,
    score:               0,
    explanation:         null,
    matchedRequirements: [],
  };
}

/**
 * Classify structures for the entire enriched universe.
 *
 * @param {object[]} universe — enriched rows (after mergeMasterDataset)
 * @param {object}   logger
 * @returns {Map<string, object>} Map<symbol, structureResult>
 */
function classifyStructures(universe, logger = console) {
  const out = new Map();
  let classified = 0;

  for (const row of universe) {
    if (!row.symbol) continue;
    const result = classifyRow(row);
    out.set(row.symbol, result);
    if (result.structure) classified++;
  }

  logger.info('structureClassifier: complete', { total: out.size, classified });
  return out;
}

module.exports = { classifyRow, classifyStructures, STRUCTURES, GRADE_ORDER };
