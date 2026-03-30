'use strict';

/**
 * intelligenceNarrative.js — Step 4 upgrade
 * Builds structured intelligence narratives from real data.
 *
 * Uses real fields only:
 *   market_metrics: gap_percent, change_percent, relative_volume, float_shares,
 *                   short_float, atr_percent, price, vwap, rsi, previous_close
 *   catalystAggregationEngine: primary_catalyst, narrative_summary
 *   premarketIntelligenceEngine: lifecycle_stage
 *
 * Output format:
 *   { why_moving, where_in_move, is_tradeable, how_to_trade, invalidation, confidence_reason }
 */

const { aggregateCatalysts } = require('../engines/catalystAggregationEngine');

function toFiniteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dayContext() {
  const d = new Date();
  const day = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()];
  const hour = d.getUTCHours();
  const isPremarket = hour < 13;  // before 09:00 ET approx
  const isAfterHours = hour >= 21;
  if (isPremarket) return `${day} pre-market`;
  if (isAfterHours) return `${day} after-hours`;
  return day;
}

function buildWhyMoving({ gapPercent, changePercent, catalystResult, catalystType }) {
  const parts = [];

  // Lead with actual catalyst headline if available
  if (catalystResult?.primary_catalyst?.headline) {
    const pc = catalystResult.primary_catalyst;
    const ageH = Math.round((Date.now() - new Date(pc.published_at).getTime()) / 3_600_000);
    parts.push(`${pc.group.toUpperCase()} catalyst (${ageH}h ago): "${pc.headline.slice(0, 100)}"`);
  } else if (catalystType === 'earnings') {
    parts.push('Earnings-driven move');
  } else {
    parts.push('No recent catalyst — move likely technical or stale');
  }

  if (Math.abs(gapPercent) > 3) {
    parts.push(`${gapPercent > 0 ? 'Gap up' : 'Gap down'} ${Math.abs(gapPercent).toFixed(1)}%`);
  }
  if (Math.abs(changePercent) > 3) {
    parts.push(`${changePercent > 0 ? 'Strong upside' : 'Sharp decline'} ${Math.abs(changePercent).toFixed(1)}%`);
  }

  return parts.join(' | ');
}

function buildWhereInMove({ relativeVolume, rsi, changePercent, lifecycle }) {
  const stage = lifecycle || 'UNKNOWN';
  const rvolLabel = relativeVolume ? `RVOL ${relativeVolume.toFixed(1)}x` : 'RVOL unknown';
  const rsiLabel = rsi ? `RSI ${Math.round(rsi)}` : '';

  const context = dayContext();

  const parts = [`${context} — Stage: ${stage}`, rvolLabel];
  if (rsiLabel) parts.push(rsiLabel);

  if (stage === 'PRE_MOVE') parts.push('Early — volume not yet committed');
  if (stage === 'EXPANSION') parts.push('Active move — momentum building');
  if (stage === 'EXHAUSTION') parts.push('Extended — watch for reversal');
  if (stage === 'DEAD') parts.push('No active structure');

  return parts.filter(Boolean).join('. ');
}

function buildIsTradeable({ relativeVolume, floatShares, shortFloat, lifecycle, confidence }) {
  if (lifecycle === 'DEAD' || lifecycle === 'EXHAUSTION') return false;
  if (confidence !== null && confidence < 20) return false;
  if (relativeVolume !== null && relativeVolume < 0.3) return false;
  return true;
}

function buildHowToTrade({ price, vwap, gapPercent, structure, lifecycle }) {
  if (lifecycle === 'DEAD') return 'No trade — no catalyst, no structure';
  if (lifecycle === 'EXHAUSTION') return 'Avoid long entries — look for fades on lower volume';

  const vwapRef = (price !== null && vwap !== null)
    ? price > vwap
      ? `Price above VWAP ($${vwap.toFixed(2)}) — trend continuation`
      : `Price below VWAP ($${vwap.toFixed(2)}) — wait for reclaim`
    : null;

  const structureNote = structure === 'breakout'
    ? 'Breakout — enter on volume confirmation, not the spike'
    : structure === 'fade'
    ? 'Fade setup — wait for failed bounce, target VWAP fill'
    : structure === 'extended'
    ? 'Extended — risk/reward poor for initial entries'
    : 'Flat structure — wait for range break with volume';

  return [vwapRef, structureNote].filter(Boolean).join('. ');
}

function buildInvalidation({ price, vwap, gapPercent, atrPercent, previousClose }) {
  const parts = [];

  if (previousClose !== null && gapPercent !== null && Math.abs(gapPercent) > 2) {
    parts.push(`Gap fill at $${previousClose.toFixed(2)}`);
  }

  if (vwap !== null) {
    parts.push(`VWAP loss at $${vwap.toFixed(2)}`);
  }

  if (atrPercent !== null) {
    parts.push(`>${(atrPercent * 1.5).toFixed(1)}% adverse move (1.5x ATR)`);
  }

  return parts.length > 0 ? parts.join(' | ') : 'Close below key support';
}

function buildConfidenceReason({ relativeVolume, floatShares, shortFloat, catalystLevel, confidence }) {
  const parts = [];

  if (relativeVolume !== null && relativeVolume > 2) parts.push(`High RVOL (${relativeVolume.toFixed(1)}x)`);
  if (floatShares !== null && floatShares < 50_000_000) parts.push('Low float');
  if (shortFloat !== null && shortFloat > 15) parts.push('High short interest');
  if (catalystLevel === 'HIGH') parts.push('Fresh catalyst (<12h)');
  if (catalystLevel === 'MEDIUM') parts.push('Catalyst present (12–48h)');
  if (catalystLevel === 'NONE') parts.push('No catalyst — lower conviction');

  if (parts.length === 0) parts.push('Momentum only');

  return `${parts.join(' + ')} → confidence ${confidence ?? 'N/A'}`;
}

// ── Legacy function (backward compat) ────────────────────────────────────────

function buildNarrative(row) {
  const safeRow = row && typeof row === 'object' ? row : {};

  const gapPercent    = toFiniteOrNull(safeRow.gap_percent) ?? 0;
  const changePercent = toFiniteOrNull(safeRow.change_percent) ?? 0;
  const relativeVolume = toFiniteOrNull(safeRow.relative_volume);
  const floatShares   = toFiniteOrNull(safeRow.float_shares);
  const shortFloat    = toFiniteOrNull(safeRow.short_float);
  const atrPercent    = toFiniteOrNull(safeRow.atr_percent);
  const price         = toFiniteOrNull(safeRow.price);
  const vwap          = toFiniteOrNull(safeRow.vwap);

  const whyMovingParts = [];
  if (safeRow.catalyst_type === 'earnings') whyMovingParts.push('Earnings-driven move');
  if (safeRow.catalyst_type === 'news') whyMovingParts.push('News catalyst');
  if (gapPercent > 5) whyMovingParts.push(`Gap up ${gapPercent.toFixed(1)}%`);
  if (changePercent > 3) whyMovingParts.push(`Strong move ${changePercent.toFixed(1)}%`);
  if (whyMovingParts.length === 0) whyMovingParts.push('Momentum continuation');

  const whyTradeableParts = [];
  if (Number.isFinite(relativeVolume) && relativeVolume > 2) whyTradeableParts.push(`High RVOL (${relativeVolume.toFixed(2)})`);
  if (Number.isFinite(floatShares) && floatShares < 50000000) whyTradeableParts.push('Low float structure');
  if (Number.isFinite(shortFloat) && shortFloat > 10) whyTradeableParts.push('Short squeeze potential');
  if (Number.isFinite(atrPercent) && atrPercent > 3) whyTradeableParts.push(`High volatility (${atrPercent.toFixed(2)}%)`);
  if (whyTradeableParts.length === 0) whyTradeableParts.push('Moderate structure');

  let execution_plan;
  if (Number.isFinite(vwap) && Number.isFinite(price) && price > vwap) {
    execution_plan = 'Holding above VWAP -> trend continuation long';
  } else if (Number.isFinite(vwap) && Number.isFinite(price) && price < vwap) {
    execution_plan = 'Below VWAP -> watch reclaim before entry';
  } else {
    execution_plan = 'Breakout with volume confirmation';
  }

  return {
    why_moving:    whyMovingParts.join(' + '),
    why_tradeable: whyTradeableParts.join(' + '),
    execution_plan,
  };
}

// ── New structured narrative builder ─────────────────────────────────────────

/**
 * Build full intelligence narrative for a symbol.
 * Requires pre-fetched metrics + optional premarket intelligence row.
 *
 * @param {object} params
 * @param {object} params.metrics       row from market_metrics
 * @param {object} [params.premarket]   row from premarket_intelligence
 * @param {object} [params.catalystResult]  result from aggregateCatalysts()
 * @returns {object}  { why_moving, where_in_move, is_tradeable, how_to_trade, invalidation, confidence_reason }
 */
function buildIntelligenceNarrative({ metrics, premarket, catalystResult }) {
  const m = metrics || {};
  const p = premarket || {};

  const gapPercent     = toFiniteOrNull(m.gap_percent) ?? 0;
  const changePercent  = toFiniteOrNull(m.change_percent) ?? 0;
  const relativeVolume = toFiniteOrNull(m.relative_volume);
  const floatShares    = toFiniteOrNull(m.float_shares);
  const shortFloat     = toFiniteOrNull(m.short_float);
  const atrPercent     = toFiniteOrNull(m.atr_percent);
  const price          = toFiniteOrNull(m.price);
  const vwap           = toFiniteOrNull(m.vwap);
  const rsi            = toFiniteOrNull(m.rsi);
  const previousClose  = toFiniteOrNull(m.previous_close);
  const lifecycle      = p.lifecycle_stage || 'UNKNOWN';
  const catalystLevel  = p.catalyst_level || 'NONE';
  const confidence     = toFiniteOrNull(p.confidence);

  const structure = gapPercent > 4 ? 'breakout'
    : changePercent < -4 ? 'fade'
    : (rsi !== null && rsi > 70) ? 'extended'
    : 'flat';

  return {
    why_moving: buildWhyMoving({ gapPercent, changePercent, catalystResult, catalystType: m.catalyst_type }),
    where_in_move: buildWhereInMove({ relativeVolume, rsi, changePercent, lifecycle }),
    is_tradeable: buildIsTradeable({ relativeVolume, floatShares, shortFloat, lifecycle, confidence }),
    how_to_trade: buildHowToTrade({ price, vwap, gapPercent, structure, lifecycle }),
    invalidation: buildInvalidation({ price, vwap, gapPercent, atrPercent, previousClose }),
    confidence_reason: buildConfidenceReason({ relativeVolume, floatShares, shortFloat, catalystLevel, confidence }),
  };
}

/**
 * Full async narrative for a symbol — fetches catalysts and builds narrative.
 */
async function buildSymbolNarrative(symbol, metrics, premarket) {
  let catalystResult = null;
  try {
    catalystResult = await aggregateCatalysts(symbol);
  } catch (_) {}

  return buildIntelligenceNarrative({ metrics, premarket, catalystResult });
}

module.exports = {
  buildNarrative,              // legacy — preserved
  buildIntelligenceNarrative,  // new structured output
  buildSymbolNarrative,        // async — fetches catalysts internally
};
