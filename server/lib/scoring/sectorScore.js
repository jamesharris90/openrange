/**
 * Sector & Relative Strength Score (0–10)
 * 
 * Evaluates the stock's position relative to its sector:
 *   - Stock vs sector ETF intraday performance
 *   - Sector trend (positive/negative day)
 *   - Relative strength premium
 */

const W = require('../config/scoringWeights');

function score(data) {
  const { stockChangePercent, sectorETF, sectorPerformance, sectorName } = data;
  const max = W.categories.sector.max;
  let pts = 0;
  const breakdown = [];

  if (!sectorPerformance || !sectorETF) {
    breakdown.push({ factor: 'Sector Relative Strength', value: 'N/A', note: 'Sector data unavailable', points: 0 });
    return { score: 0, max, breakdown, available: false };
  }

  const sectorData = sectorPerformance.find(s => s.etf === sectorETF);
  if (!sectorData) {
    breakdown.push({ factor: 'Sector Relative Strength', value: 'N/A', note: `Sector ETF ${sectorETF} not found`, points: 0 });
    return { score: 0, max, breakdown, available: false };
  }

  const sectorChange = sectorData.changePercent || 0;

  // --- 1. Relative Strength vs Sector (0–5) ---
  if (stockChangePercent != null) {
    const relativeStrength = stockChangePercent - sectorChange;

    if (relativeStrength > 1.5) {
      pts += 5;
      breakdown.push({
        factor: 'RS vs Sector',
        value: `+${relativeStrength.toFixed(2)}%`,
        note: `Strong outperformance vs ${sectorETF} (${sectorName})`,
        points: 5
      });
    } else if (relativeStrength > 0.5) {
      pts += 3;
      breakdown.push({
        factor: 'RS vs Sector',
        value: `+${relativeStrength.toFixed(2)}%`,
        note: `Moderate outperformance vs ${sectorETF}`,
        points: 3
      });
    } else if (relativeStrength > -0.5) {
      pts += 2;
      breakdown.push({
        factor: 'RS vs Sector',
        value: `${relativeStrength >= 0 ? '+' : ''}${relativeStrength.toFixed(2)}%`,
        note: `In-line with sector`,
        points: 2
      });
    } else if (relativeStrength > -1.5) {
      pts += 1;
      breakdown.push({
        factor: 'RS vs Sector',
        value: `${relativeStrength.toFixed(2)}%`,
        note: `Underperforming sector`,
        points: 1
      });
    } else {
      breakdown.push({
        factor: 'RS vs Sector',
        value: `${relativeStrength.toFixed(2)}%`,
        note: `Significant underperformance`,
        points: 0
      });
    }
  } else {
    breakdown.push({ factor: 'RS vs Sector', value: 'N/A', note: 'Stock change unavailable', points: 0 });
  }

  // --- 2. Sector Trend (0–3) ---
  if (sectorChange > 0.5) {
    pts += 3;
    breakdown.push({ factor: 'Sector Trend', value: `${sectorETF} +${sectorChange.toFixed(2)}%`, note: 'Sector in uptrend', points: 3 });
  } else if (sectorChange > -0.5) {
    pts += 2;
    breakdown.push({ factor: 'Sector Trend', value: `${sectorETF} ${sectorChange >= 0 ? '+' : ''}${sectorChange.toFixed(2)}%`, note: 'Sector flat', points: 2 });
  } else {
    pts += 1;
    breakdown.push({ factor: 'Sector Trend', value: `${sectorETF} ${sectorChange.toFixed(2)}%`, note: 'Sector declining', points: 1 });
  }

  // --- 3. Sector Rank in Market (0–2) ---
  if (sectorPerformance && sectorPerformance.length > 0) {
    const sorted = [...sectorPerformance].sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));
    const rank = sorted.findIndex(s => s.etf === sectorETF) + 1;
    const total = sorted.length;

    if (rank <= Math.ceil(total / 4)) {
      pts += 2;
      breakdown.push({ factor: 'Sector Rank', value: `#${rank}/${total}`, note: 'Top quartile sector', points: 2 });
    } else if (rank <= Math.ceil(total / 2)) {
      pts += 1;
      breakdown.push({ factor: 'Sector Rank', value: `#${rank}/${total}`, note: 'Upper half', points: 1 });
    } else {
      breakdown.push({ factor: 'Sector Rank', value: `#${rank}/${total}`, note: 'Lower half — sector headwind', points: 0 });
    }
  }

  return { score: Math.min(pts, max), max, breakdown, available: true };
}

module.exports = { score };
