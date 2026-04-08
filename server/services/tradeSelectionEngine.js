'use strict';

/**
 * Trade Selection Engine
 *
 * Deterministic, no LLM.
 *
 * Scores every narrative signal on four dimensions (0–100 each):
 *   confidence        35% — performance-adjusted signal confidence
 *   regime_alignment  25% — how well current regime matches setup's best regime
 *   catalyst_strength 20% — quality/type of catalyst from consequence text
 *   liquidity         20% — relative volume + market cap
 *
 * Hard filters remove:
 *   - confidence < 50
 *   - consequence starts with "No edge" / "Low conviction"
 *   - entry price = 0 (no live data)
 *   - MISALIGNED regime AND confidence < 70
 *
 * Outputs top N sorted by trade_score DESC.
 */

const { getBestRegimeForSetup } = require('./signalEvaluationEngine');
const { getCurrentRegime }      = require('./marketRegimeEngine');

// ─── regime alignment ─────────────────────────────────────────────────────────

/**
 * Returns { score: 0–100, label: 'ALIGNED'|'PARTIAL'|'NEUTRAL'|'MISALIGNED' }
 *
 * Parses the best-regime string produced by getBestRegimeForSetup:
 *   "BULL trend + LOW vol"
 */
function computeRegimeAlignment(setup_type, consequence, currentRegime) {
  const bestStr = getBestRegimeForSetup(setup_type, consequence);

  if (!bestStr || !currentRegime) return { score: 60, label: 'NEUTRAL' };

  const parts     = bestStr.split(' trend + ');
  const bestTrend = parts[0] || null;
  const bestVol   = (parts[1] || '').replace(' vol', '') || null;

  const trendMatch = bestTrend && currentRegime.trend      === bestTrend;
  const volMatch   = bestVol   && currentRegime.volatility === bestVol;

  if (trendMatch && volMatch)  return { score: 100, label: 'ALIGNED'    };
  if (trendMatch || volMatch)  return { score: 70,  label: 'PARTIAL'    };
  return                              { score: 25,  label: 'MISALIGNED' };
}

// ─── catalyst strength from consequence text ──────────────────────────────────

function scoreCatalyst(consequence) {
  if (!consequence) return 30;
  const c = consequence.toLowerCase();

  if (c.includes('no edge') || c.includes('low conviction'))  return 0;   // should be filtered
  if (c.includes('confirmed') || c.includes('continuation'))  return 100; // best: price + vol aligned
  if (c.includes('failed') || c.includes('absorbed'))         return 75;  // clear contrarian setup
  if (c.includes('bias') && !c.includes('low conviction'))    return 65;  // directional, unconfirmed
  if (c.includes('mixed') || c.includes('awaiting'))          return 40;  // ambiguous
  if (c.includes('range-bound'))                              return 35;  // mean-reversion only

  return 40; // default — unclassified
}

// ─── liquidity score ──────────────────────────────────────────────────────────

function scoreLiquidity(relative_volume, market_cap) {
  const rvol = Number(relative_volume || 0);
  const mcap = Number(market_cap      || 0);

  let score;
  if      (rvol >= 3)   score = 100;
  else if (rvol >= 2)   score = 80;
  else if (rvol >= 1.5) score = 60;
  else if (rvol >= 1)   score = 40;
  else                  score = 20;

  // Market cap liquidity bonus
  if      (mcap > 10_000_000_000) score = Math.min(100, score + 15); // mega/large cap
  else if (mcap >  1_000_000_000) score = Math.min(100, score + 5);  // mid cap

  return score;
}

// ─── main trade score ─────────────────────────────────────────────────────────

/**
 * Compute composite trade score for a signal row.
 * Returns { trade_score, regime_alignment, components }
 */
function scoreSignal(signal, currentRegime) {
  const confidence     = Math.max(0, Math.min(100, Number(signal.confidence || 0)));
  const regimeAlign    = computeRegimeAlignment(signal.setup_type, signal.consequence, currentRegime);
  const catalystScore  = scoreCatalyst(signal.consequence);
  const liquidityScore = scoreLiquidity(signal.relative_volume, signal.market_cap);

  const raw = (
    confidence          * 0.35 +
    regimeAlign.score   * 0.25 +
    catalystScore       * 0.20 +
    liquidityScore      * 0.20
  );

  return {
    trade_score:      Math.round(Math.max(0, Math.min(100, raw))),
    regime_alignment: regimeAlign.label,
    components: {
      confidence,
      regime:   regimeAlign.score,
      catalyst: catalystScore,
      liquidity: liquidityScore,
    },
  };
}

// ─── hard filter ─────────────────────────────────────────────────────────────

/**
 * Returns true if the signal should be EXCLUDED from top-focus.
 * Filters before scoring to avoid wasting compute and to keep the list clean.
 */
function shouldFilter(signal) {
  if (Number(signal.confidence || 0) < 50)  return true;
  if (!signal.consequence)                   return true;

  const c = (signal.consequence || '').toLowerCase();
  if (c.startsWith('no edge'))               return true;
  if (c.startsWith('low conviction'))        return true;

  const price = Number(signal.price || signal.entry_price || 0);
  if (price <= 0)                            return true;

  return false;
}

// ─── top opportunity selection ────────────────────────────────────────────────

/**
 * Apply hard filters + score all passing signals + apply regime penalty.
 * Returns sorted top N.
 *
 * @param {Array}  signals  rows from opportunity_stream + market_metrics join
 * @param {number} limit    max results
 */
function selectTopOpportunities(signals, limit = 5) {
  const regime    = getCurrentRegime();
  const scored    = [];
  let   nFiltered = 0;

  for (const sig of signals) {
    if (shouldFilter(sig)) { nFiltered++; continue; }

    const result = scoreSignal(sig, regime);

    // Regime penalty: MISALIGNED requires higher confidence to surface
    if (result.regime_alignment === 'MISALIGNED' && Number(sig.confidence || 0) < 70) {
      nFiltered++;
      continue;
    }

    scored.push({ ...sig, ...result });
  }

  // Sort by trade_score DESC, confidence as tiebreaker
  scored.sort((a, b) => b.trade_score - a.trade_score || b.confidence - a.confidence);

  return {
    top:            scored.slice(0, limit),
    total_scored:   scored.length,
    total_filtered: nFiltered,
    regime,
  };
}

// ─── entry / stop / target levels ────────────────────────────────────────────

/**
 * Derive structured entry/stop/target from intraday data + consequence direction.
 *
 * Rules:
 *   LONG  — stop = intraday_low,  target = entry + (entry - stop) × 2  (2R)
 *   SHORT — stop = intraday_high, target = entry - (stop - entry) × 2
 *   Default 1R fallback = 1% of price when intraday levels unavailable.
 */
function computeLevels(signal) {
  const price = Number(signal.price || 0);
  if (price <= 0) return { entry: null, stop: null, target: null, direction: 'UNKNOWN' };

  const high  = Number(signal.intraday_high || 0);
  const low   = Number(signal.intraday_low  || 0);
  const c     = (signal.consequence || '').toLowerCase();

  const isLong  = /\blong\b|continuation|upside|absorbed|bullish(?! news not)/.test(c) && !/\bshort\b/.test(c);
  const isShort = /\bshort\b|downside|failed bullish|selling|not being bought/.test(c) && !isLong;

  // Fallback: use change_percent direction when consequence is ambiguous
  const chg = Number(signal.change_percent || 0);
  const dirFromPrice = chg > 0.5 ? 'long' : chg < -0.5 ? 'short' : null;

  const finalLong  = isLong  || (!isLong && !isShort && dirFromPrice === 'long');
  const finalShort = isShort || (!isLong && !isShort && dirFromPrice === 'short');

  if (finalLong) {
    const stop   = low > 0 && low < price ? +low.toFixed(2) : +(price * 0.99).toFixed(2);
    const r      = price - stop;
    const target = +(price + r * 2).toFixed(2);
    return { entry: +price.toFixed(2), stop, target, direction: 'LONG' };
  }

  if (finalShort) {
    const stop   = high > 0 && high > price ? +high.toFixed(2) : +(price * 1.01).toFixed(2);
    const r      = stop - price;
    const target = +(price - r * 2).toFixed(2);
    return { entry: +price.toFixed(2), stop, target, direction: 'SHORT' };
  }

  return { entry: +price.toFixed(2), stop: null, target: null, direction: 'NEUTRAL' };
}

module.exports = {
  scoreSignal,
  shouldFilter,
  selectTopOpportunities,
  computeRegimeAlignment,
  computeLevels,
};
