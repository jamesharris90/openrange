/**
 * Technical Alignment Score (0–10)
 * 
 * Evaluates technical factors affecting expected move quality:
 *   - Daily trend alignment (price vs SMAs)
 *   - EM vs ATR ratio (expected move reasonableness)
 *   - Distance to key levels (support/resistance proxy)
 *   - EM landing zone assessment
 */

const W = require('../config/scoringWeights');

function score(data) {
  const {
    price, closes, expectedMove, atr14,
    sma20, sma50, sma200,
    high52w, low52w
  } = data;
  const max = W.categories.technical.max;
  let pts = 0;
  const breakdown = [];

  // --- 1. Daily Trend Alignment (0–4) ---
  let trendCount = 0;
  if (sma20 != null && price > sma20) trendCount++;
  if (sma50 != null && price > sma50) trendCount++;
  if (sma200 != null && price > sma200) trendCount++;

  if (trendCount === 3) {
    pts += 4;
    breakdown.push({ factor: 'Trend Alignment', value: '3/3 MAs bullish', note: 'Strong uptrend — EM directionally supported', points: 4 });
  } else if (trendCount === 2) {
    pts += 3;
    breakdown.push({ factor: 'Trend Alignment', value: `${trendCount}/3 MAs bullish`, note: 'Moderate trend alignment', points: 3 });
  } else if (trendCount === 1) {
    pts += 1;
    breakdown.push({ factor: 'Trend Alignment', value: `${trendCount}/3 MAs bullish`, note: 'Weak alignment — conflicting signals', points: 1 });
  } else if (sma20 != null) {
    pts += 0;
    breakdown.push({ factor: 'Trend Alignment', value: '0/3 MAs bullish', note: 'Downtrend — EM may expand to downside', points: 0 });
  } else {
    breakdown.push({ factor: 'Trend Alignment', value: 'N/A', note: 'Insufficient data for SMAs', points: 0 });
  }

  // --- 2. EM vs ATR Ratio (0–3) ---
  if (expectedMove != null && atr14 != null && atr14 > 0) {
    const emAtrRatio = expectedMove / atr14;

    if (emAtrRatio >= 0.8 && emAtrRatio <= 1.5) {
      pts += 3;
      breakdown.push({ factor: 'EM vs ATR', value: `${emAtrRatio.toFixed(2)}x`, note: 'EM well-calibrated to daily range', points: 3 });
    } else if (emAtrRatio >= 0.5 && emAtrRatio <= 2.0) {
      pts += 2;
      breakdown.push({ factor: 'EM vs ATR', value: `${emAtrRatio.toFixed(2)}x`, note: 'EM reasonable vs daily range', points: 2 });
    } else if (emAtrRatio > 2.0) {
      pts += 1;
      breakdown.push({ factor: 'EM vs ATR', value: `${emAtrRatio.toFixed(2)}x`, note: 'EM stretches well beyond daily ATR', points: 1 });
    } else {
      pts += 1;
      breakdown.push({ factor: 'EM vs ATR', value: `${emAtrRatio.toFixed(2)}x`, note: 'EM narrower than daily range', points: 1 });
    }
  } else {
    breakdown.push({ factor: 'EM vs ATR', value: 'N/A', note: 'ATR unavailable', points: 0 });
  }

  // --- 3. Distance to 52-Week Levels (0–3) ---
  if (high52w != null && low52w != null && price > 0) {
    const range52w = high52w - low52w;
    if (range52w > 0) {
      const positionInRange = (price - low52w) / range52w;
      const distToHigh = ((high52w - price) / price) * 100;
      const distToLow = ((price - low52w) / price) * 100;

      if (positionInRange > 0.85) {
        pts += 1;
        breakdown.push({ factor: '52W Position', value: `${(positionInRange * 100).toFixed(0)}th percentile`, note: `Near 52W high — ${distToHigh.toFixed(1)}% below`, points: 1 });
      } else if (positionInRange > 0.5) {
        pts += 3;
        breakdown.push({ factor: '52W Position', value: `${(positionInRange * 100).toFixed(0)}th percentile`, note: 'Mid-range — room both directions', points: 3 });
      } else if (positionInRange > 0.15) {
        pts += 2;
        breakdown.push({ factor: '52W Position', value: `${(positionInRange * 100).toFixed(0)}th percentile`, note: 'Lower range — bounce potential', points: 2 });
      } else {
        pts += 1;
        breakdown.push({ factor: '52W Position', value: `${(positionInRange * 100).toFixed(0)}th percentile`, note: `Near 52W low — ${distToLow.toFixed(1)}% above`, points: 1 });
      }
    }
  } else {
    breakdown.push({ factor: '52W Position', value: 'N/A', note: 'Insufficient data', points: 0 });
  }

  const available = (sma20 != null || sma50 != null) || (high52w != null && low52w != null);
  return { score: Math.min(pts, max), max, breakdown, available };
}

module.exports = { score };
