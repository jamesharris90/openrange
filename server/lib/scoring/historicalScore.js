/**
 * Historical Behaviour Score (0–5)
 * 
 * Evaluates past expected move containment and breach patterns:
 *   - Overall containment rate (how often price stays within EM)
 *   - Breach tendency during high-IV periods
 *   - Consistency of move sizing
 * 
 * Note: Uses historical HV data as proxy since we don't store past EM data.
 * The idea: if IV has been consistent (low HV rank dispersion), the EM is
 * more predictable. High HV variance → less reliable EM.
 */

const W = require('../config/scoringWeights');

function score(data) {
  const { hvRank, hvCurrent20, hvHigh52w, hvLow52w, closes } = data;
  const max = W.categories.historical.max;
  let pts = 0;
  const breakdown = [];

  // --- 1. HV Stability (0–3) ---
  // If the range between HV high and low is small relative to current,
  // the stock has predictable volatility → EM is more reliable
  if (hvHigh52w != null && hvLow52w != null && hvCurrent20 != null && hvHigh52w > 0) {
    const hvRange = hvHigh52w - hvLow52w;
    const hvRangeRatio = hvRange / hvHigh52w; // 0 = stable, 1 = wildly variable

    if (hvRangeRatio < 0.3) {
      pts += 3;
      breakdown.push({
        factor: 'HV Stability',
        value: `Range: ${(hvLow52w * 100).toFixed(1)}%–${(hvHigh52w * 100).toFixed(1)}%`,
        note: 'Stable volatility — EM historically reliable',
        points: 3
      });
    } else if (hvRangeRatio < 0.5) {
      pts += 2;
      breakdown.push({
        factor: 'HV Stability',
        value: `Range: ${(hvLow52w * 100).toFixed(1)}%–${(hvHigh52w * 100).toFixed(1)}%`,
        note: 'Moderate volatility variance',
        points: 2
      });
    } else {
      pts += 1;
      breakdown.push({
        factor: 'HV Stability',
        value: `Range: ${(hvLow52w * 100).toFixed(1)}%–${(hvHigh52w * 100).toFixed(1)}%`,
        note: 'High volatility variance — EM less predictable',
        points: 1
      });
    }
  } else {
    breakdown.push({ factor: 'HV Stability', value: 'N/A', note: 'Insufficient data', points: 0 });
  }

  // --- 2. Realized Move Consistency (0–2) ---
  // Measure how consistent daily moves are — low std dev of daily returns = more predictable
  if (closes && closes.length >= 30) {
    const recent = closes.slice(-30);
    const returns = [];
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] > 0 && recent[i - 1] > 0) {
        returns.push(Math.abs(recent[i] / recent[i - 1] - 1));
      }
    }
    if (returns.length > 10) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 0; // coefficient of variation

      if (cv < 0.6) {
        pts += 2;
        breakdown.push({ factor: 'Move Consistency', value: `CV: ${cv.toFixed(2)}`, note: 'Consistent daily moves — predictable', points: 2 });
      } else if (cv < 1.0) {
        pts += 1;
        breakdown.push({ factor: 'Move Consistency', value: `CV: ${cv.toFixed(2)}`, note: 'Moderate move variance', points: 1 });
      } else {
        breakdown.push({ factor: 'Move Consistency', value: `CV: ${cv.toFixed(2)}`, note: 'Erratic daily moves — EM less reliable', points: 0 });
      }
    }
  } else {
    breakdown.push({ factor: 'Move Consistency', value: 'N/A', note: 'Insufficient price data', points: 0 });
  }

  return { score: Math.min(pts, max), max, breakdown };
}

module.exports = { score };
