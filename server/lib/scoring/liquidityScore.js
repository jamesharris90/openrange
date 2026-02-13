/**
 * Liquidity Score (0–15)
 * 
 * Measures option market depth and execution quality:
 *   - ATM Open Interest depth
 *   - Bid/Ask spread tightness
 *   - Volume/OI ratio (activity)
 *   - Market cap liquidity proxy
 */

const W = require('../config/scoringWeights');

function score(data) {
  const { atmCall, atmPut, marketCap, price } = data;
  const cfg = W.liquidity;
  const max = W.categories.liquidity.max;
  let pts = 0;
  const breakdown = [];

  // --- 1. Open Interest (0–5) ---
  const callOI = atmCall?.openInterest || 0;
  const putOI = atmPut?.openInterest || 0;
  const totalOI = callOI + putOI;

  if (totalOI >= cfg.oi.excellent) {
    pts += 5;
    breakdown.push({ factor: 'Open Interest', value: totalOI, note: 'Deep liquidity', points: 5 });
  } else if (totalOI >= cfg.oi.good) {
    pts += 3;
    breakdown.push({ factor: 'Open Interest', value: totalOI, note: 'Adequate liquidity', points: 3 });
  } else if (totalOI >= cfg.oi.fair) {
    pts += 1;
    breakdown.push({ factor: 'Open Interest', value: totalOI, note: 'Thin liquidity', points: 1 });
  } else {
    breakdown.push({ factor: 'Open Interest', value: totalOI, note: 'Illiquid — wide fills likely', points: 0 });
  }

  // --- 2. Bid/Ask Spread Tightness (0–4) ---
  const callSpread = (atmCall?.ask && atmCall?.bid && atmCall.ask > 0) ? (atmCall.ask - atmCall.bid) / atmCall.ask : null;
  const putSpread = (atmPut?.ask && atmPut?.bid && atmPut.ask > 0) ? (atmPut.ask - atmPut.bid) / atmPut.ask : null;
  const spreads = [callSpread, putSpread].filter(s => s != null);
  const avgSpread = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null;

  if (avgSpread != null) {
    if (avgSpread <= cfg.bidAskSpread.tight) {
      pts += 4;
      breakdown.push({ factor: 'Bid/Ask Spread', value: `${(avgSpread * 100).toFixed(1)}%`, note: 'Tight spreads', points: 4 });
    } else if (avgSpread <= cfg.bidAskSpread.moderate) {
      pts += 2;
      breakdown.push({ factor: 'Bid/Ask Spread', value: `${(avgSpread * 100).toFixed(1)}%`, note: 'Moderate spreads', points: 2 });
    } else if (avgSpread <= cfg.bidAskSpread.wide) {
      pts += 1;
      breakdown.push({ factor: 'Bid/Ask Spread', value: `${(avgSpread * 100).toFixed(1)}%`, note: 'Wide spreads — fill risk', points: 1 });
    } else {
      breakdown.push({ factor: 'Bid/Ask Spread', value: `${(avgSpread * 100).toFixed(1)}%`, note: 'Very wide — avoid market orders', points: 0 });
    }
  } else {
    breakdown.push({ factor: 'Bid/Ask Spread', value: 'N/A', note: 'Spread data unavailable (off-hours)', points: 0 });
  }

  // --- 3. Volume/OI Ratio (0–3) ---
  const callVol = atmCall?.volume || 0;
  const putVol = atmPut?.volume || 0;
  const totalVol = callVol + putVol;
  const volOiRatio = totalOI > 0 ? totalVol / totalOI : 0;

  if (volOiRatio >= cfg.volumeOiRatio.active) {
    pts += 3;
    breakdown.push({ factor: 'Volume/OI Ratio', value: volOiRatio.toFixed(2), note: 'Active trading', points: 3 });
  } else if (volOiRatio >= cfg.volumeOiRatio.moderate) {
    pts += 2;
    breakdown.push({ factor: 'Volume/OI Ratio', value: volOiRatio.toFixed(2), note: 'Moderate activity', points: 2 });
  } else if (totalVol > 0) {
    pts += 1;
    breakdown.push({ factor: 'Volume/OI Ratio', value: volOiRatio.toFixed(2), note: 'Low activity', points: 1 });
  } else {
    breakdown.push({ factor: 'Volume/OI Ratio', value: '0', note: 'No volume (off-hours?)', points: 0 });
  }

  // --- 4. Market Cap (0–3) ---
  if (marketCap) {
    if (marketCap >= cfg.marketCap.large) {
      pts += 3;
      breakdown.push({ factor: 'Market Cap', value: formatCap(marketCap), note: 'Large cap', points: 3 });
    } else if (marketCap >= cfg.marketCap.mid) {
      pts += 2;
      breakdown.push({ factor: 'Market Cap', value: formatCap(marketCap), note: 'Mid cap', points: 2 });
    } else if (marketCap >= cfg.marketCap.small) {
      pts += 1;
      breakdown.push({ factor: 'Market Cap', value: formatCap(marketCap), note: 'Small cap', points: 1 });
    } else {
      breakdown.push({ factor: 'Market Cap', value: formatCap(marketCap), note: 'Micro cap — wide spreads likely', points: 0 });
    }
  } else {
    breakdown.push({ factor: 'Market Cap', value: 'N/A', note: 'Unavailable', points: 0 });
  }

  return { score: Math.min(pts, max), max, breakdown };
}

function formatCap(n) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n}`;
}

module.exports = { score };
