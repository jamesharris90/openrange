/**
 * Market Regime Score (0–15)
 * 
 * Assesses broader market conditions that affect expected move reliability:
 *   - SPY trend (20/50 SMA alignment)
 *   - VIX regime classification
 *   - Beta-adjusted market move contribution
 *   - Index expected move comparison
 */

const W = require('../config/scoringWeights');

function score(data) {
  const { marketContext, beta, expectedMovePercent, spyExpectedMovePercent } = data;
  const cfg = W.marketRegime;
  const max = W.categories.marketRegime.max;
  let pts = 0;
  const breakdown = [];

  if (!marketContext) {
    breakdown.push({ factor: 'Market Regime', value: 'N/A', note: 'Market context unavailable', points: 0 });
    return { score: 0, max, breakdown, available: false };
  }

  const { technicals, bias, indices } = marketContext;
  const spy = technicals?.SPY || {};
  const vixObj = (indices || []).find(i => (i.ticker || '').includes('VIX'));
  const vixPrice = vixObj?.price || 0;

  // --- 1. SPY Trend Alignment (0–5) ---
  let trendCount = 0;
  if (spy.aboveSMA9) trendCount++;
  if (spy.aboveSMA20) trendCount++;
  if (spy.aboveSMA50) trendCount++;

  if (trendCount >= cfg.trendStrength.strong) {
    pts += 5;
    breakdown.push({ factor: 'SPY Trend', value: `${trendCount}/3 MAs bullish`, note: 'Strong uptrend — supportive regime', points: 5 });
  } else if (trendCount >= cfg.trendStrength.moderate) {
    pts += 3;
    breakdown.push({ factor: 'SPY Trend', value: `${trendCount}/3 MAs bullish`, note: 'Mixed trend — neutral regime', points: 3 });
  } else if (trendCount >= 1) {
    pts += 2;
    breakdown.push({ factor: 'SPY Trend', value: `${trendCount}/3 MAs bullish`, note: 'Weak trend — caution', points: 2 });
  } else {
    pts += 1;
    breakdown.push({ factor: 'SPY Trend', value: 'All MAs bearish', note: 'Downtrend — elevated risk', points: 1 });
  }

  // --- 2. VIX Regime (0–5) ---
  if (vixPrice > 0) {
    if (vixPrice < cfg.vix.calm) {
      pts += 5;
      breakdown.push({ factor: 'VIX Regime', value: vixPrice.toFixed(1), note: 'Calm — expected moves likely contained', points: 5 });
    } else if (vixPrice < cfg.vix.cautious) {
      pts += 4;
      breakdown.push({ factor: 'VIX Regime', value: vixPrice.toFixed(1), note: 'Normal — standard move reliability', points: 4 });
    } else if (vixPrice < cfg.vix.elevated) {
      pts += 2;
      breakdown.push({ factor: 'VIX Regime', value: vixPrice.toFixed(1), note: 'Cautious — moves may expand', points: 2 });
    } else if (vixPrice < cfg.vix.panic) {
      pts += 1;
      breakdown.push({ factor: 'VIX Regime', value: vixPrice.toFixed(1), note: 'Elevated — expect expansion', points: 1 });
    } else {
      pts += 0;
      breakdown.push({ factor: 'VIX Regime', value: vixPrice.toFixed(1), note: 'Panic — EM unreliable', points: 0 });
    }
  } else {
    breakdown.push({ factor: 'VIX Regime', value: 'N/A', note: 'VIX unavailable', points: 0 });
  }

  // --- 3. Beta-Adjusted Market Move (0–3) ---
  if (beta != null && spyExpectedMovePercent != null && expectedMovePercent != null) {
    const betaAdjustedMove = beta * spyExpectedMovePercent;
    const alphaComponent = expectedMovePercent - betaAdjustedMove;
    
    if (alphaComponent > 1.0) {
      pts += 3;
      breakdown.push({
        factor: 'Beta-Adjusted Alpha',
        value: `${alphaComponent.toFixed(2)}% above beta`,
        note: `Stock EM has ${alphaComponent.toFixed(1)}% idiosyncratic component (β=${beta.toFixed(2)})`,
        points: 3
      });
    } else if (alphaComponent > 0.3) {
      pts += 2;
      breakdown.push({
        factor: 'Beta-Adjusted Alpha',
        value: `${alphaComponent.toFixed(2)}% above beta`,
        note: `Moderate alpha component (β=${beta.toFixed(2)})`,
        points: 2
      });
    } else {
      pts += 1;
      breakdown.push({
        factor: 'Beta-Adjusted Alpha',
        value: `${alphaComponent.toFixed(2)}%`,
        note: `Mostly market-driven (β=${beta.toFixed(2)})`,
        points: 1
      });
    }
  } else {
    breakdown.push({ factor: 'Beta-Adjusted Alpha', value: 'N/A', note: 'Beta data unavailable', points: 0 });
  }

  // --- 4. Market Bias Alignment (0–2) ---
  if (bias) {
    if (bias === 'bullish') {
      pts += 2;
      breakdown.push({ factor: 'Market Bias', value: 'Bullish', note: 'Favourable market backdrop', points: 2 });
    } else if (bias === 'neutral') {
      pts += 1;
      breakdown.push({ factor: 'Market Bias', value: 'Neutral', note: 'No directional edge from market', points: 1 });
    } else {
      pts += 0;
      breakdown.push({ factor: 'Market Bias', value: 'Bearish', note: 'Adverse market conditions', points: 0 });
    }
  } else {
    breakdown.push({ factor: 'Market Bias', value: 'N/A', note: 'Unavailable', points: 0 });
  }

  return { score: Math.min(pts, max), max, breakdown, available: true };
}

module.exports = { score };
