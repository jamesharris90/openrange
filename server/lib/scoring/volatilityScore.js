/**
 * Volatility Context Score (0–20)
 * 
 * Evaluates how rich or cheap implied volatility is relative to realized:
 *   - IV Rank (52-week position)
 *   - IV vs 30-day HV spread
 *   - IV Percentile proxy (from HV rank)
 *   - Earnings IV crush flag
 */

const W = require('../config/scoringWeights');

function score(data) {
  const { avgIV, hvCurrent20, hvRank, hvHigh52w, hvLow52w, earningsInDays, daysToExpiry } = data;
  const cfg = W.volatility;
  const max = W.categories.volatility.max;
  let pts = 0;
  const breakdown = [];

  // --- 1. IV Rank / HV Rank (0–7) ---
  // We use HV Rank as a proxy for IV Rank since we have 52-week HV data
  if (hvRank != null) {
    if (hvRank >= cfg.ivRank.high) {
      pts += 7;
      breakdown.push({ factor: 'IV Rank', value: `${hvRank.toFixed(0)}%`, note: 'High — premium is rich', points: 7 });
    } else if (hvRank >= cfg.ivRank.elevated) {
      pts += 5;
      breakdown.push({ factor: 'IV Rank', value: `${hvRank.toFixed(0)}%`, note: 'Elevated — above average', points: 5 });
    } else if (hvRank >= cfg.ivRank.normal) {
      pts += 3;
      breakdown.push({ factor: 'IV Rank', value: `${hvRank.toFixed(0)}%`, note: 'Normal range', points: 3 });
    } else {
      pts += 1;
      breakdown.push({ factor: 'IV Rank', value: `${hvRank.toFixed(0)}%`, note: 'Low — cheap premium', points: 1 });
    }
  } else {
    breakdown.push({ factor: 'IV Rank', value: 'N/A', note: 'Insufficient history', points: 0 });
  }

  // --- 2. IV vs HV Spread (0–6) ---
  if (avgIV != null && hvCurrent20 != null) {
    const spread = avgIV - hvCurrent20;
    const spreadPct = (spread * 100).toFixed(1);

    if (spread > cfg.ivHvSpread.significant) {
      pts += 6;
      breakdown.push({ factor: 'IV vs HV Spread', value: `+${spreadPct}%`, note: 'Significant IV premium — overpriced options', points: 6 });
    } else if (spread > cfg.ivHvSpread.moderate) {
      pts += 4;
      breakdown.push({ factor: 'IV vs HV Spread', value: `+${spreadPct}%`, note: 'Moderate IV premium', points: 4 });
    } else if (spread > 0) {
      pts += 2;
      breakdown.push({ factor: 'IV vs HV Spread', value: `+${spreadPct}%`, note: 'Slight IV premium', points: 2 });
    } else {
      pts += 1;
      breakdown.push({ factor: 'IV vs HV Spread', value: `${spreadPct}%`, note: 'IV discount — cheap options', points: 1 });
    }
  } else {
    breakdown.push({ factor: 'IV vs HV Spread', value: 'N/A', note: 'Data unavailable', points: 0 });
  }

  // --- 3. Absolute IV Level (0–4) ---
  if (avgIV != null) {
    const ivPct = avgIV * 100;
    if (ivPct > 60) {
      pts += 4;
      breakdown.push({ factor: 'Absolute IV', value: `${ivPct.toFixed(1)}%`, note: 'Very high — large expected moves', points: 4 });
    } else if (ivPct > 40) {
      pts += 3;
      breakdown.push({ factor: 'Absolute IV', value: `${ivPct.toFixed(1)}%`, note: 'High volatility', points: 3 });
    } else if (ivPct > 25) {
      pts += 2;
      breakdown.push({ factor: 'Absolute IV', value: `${ivPct.toFixed(1)}%`, note: 'Moderate volatility', points: 2 });
    } else {
      pts += 1;
      breakdown.push({ factor: 'Absolute IV', value: `${ivPct.toFixed(1)}%`, note: 'Low volatility environment', points: 1 });
    }
  } else {
    breakdown.push({ factor: 'Absolute IV', value: 'N/A', note: 'IV unavailable', points: 0 });
  }

  // --- 4. Earnings IV Crush Flag (0–3) ---
  const hasEarnings = earningsInDays != null && earningsInDays > 0;
  if (hasEarnings && earningsInDays <= cfg.earningsCrush.daysThreshold) {
    // IV is likely inflated before earnings — high crush potential
    pts += 3;
    breakdown.push({
      factor: 'Earnings IV Crush',
      value: `${earningsInDays}d to earnings`,
      note: 'IV likely inflated — crush expected post-event',
      points: 3
    });
  } else if (hasEarnings && earningsInDays <= 14) {
    pts += 1;
    breakdown.push({
      factor: 'Earnings IV Crush',
      value: `${earningsInDays}d to earnings`,
      note: 'Approaching earnings — IV building',
      points: 1
    });
  } else {
    breakdown.push({ factor: 'Earnings IV Crush', value: 'No near-term earnings', note: 'No crush catalyst', points: 0 });
  }

  return { score: Math.min(pts, max), max, breakdown };
}

module.exports = { score };
