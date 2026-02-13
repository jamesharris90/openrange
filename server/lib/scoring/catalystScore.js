/**
 * Catalyst Strength Score (0–25)
 * 
 * Identifies known or upcoming volatility catalysts:
 *   - Earnings proximity & implied significance
 *   - News freshness and density
 *   - Volume confirmation (intraday volume spike)
 *   - Event calendar presence
 */

const W = require('../config/scoringWeights');

function score(data) {
  const {
    earningsInDays,
    earningsSurprisePercent,
    earningsBeatsInLast4,
    newsItems,
    atmCall,
    atmPut,
    avgVolume20,
  } = data;
  const cfg = W.catalyst;
  const max = W.categories.catalyst.max;
  let pts = 0;
  const breakdown = [];

  // --- 1. Earnings Proximity (0–10) ---
  const hasEarnings = earningsInDays != null && earningsInDays > 0;
  if (hasEarnings && earningsInDays <= cfg.earningsProximity.imminent) {
    pts += 10;
    breakdown.push({ factor: 'Earnings Proximity', value: `${earningsInDays}d`, note: 'Imminent — max IV expansion', points: 10 });
  } else if (hasEarnings && earningsInDays <= cfg.earningsProximity.near) {
    pts += 7;
    breakdown.push({ factor: 'Earnings Proximity', value: `${earningsInDays}d`, note: 'Near-term catalyst', points: 7 });
  } else if (hasEarnings && earningsInDays <= cfg.earningsProximity.approaching) {
    pts += 4;
    breakdown.push({ factor: 'Earnings Proximity', value: `${earningsInDays}d`, note: 'Approaching — IV ramp starting', points: 4 });
  } else {
    breakdown.push({ factor: 'Earnings Proximity', value: hasEarnings ? `${earningsInDays}d` : 'None', note: 'No near-term earnings', points: 0 });
  }

  // --- 2. News Freshness & Density (0–8) ---
  const news = newsItems || [];
  const now = Date.now();
  const recentNews = news.filter(n => {
    const ts = (n.datetime || n.publishedDate || 0) * 1000;
    return (now - ts) < 24 * 60 * 60 * 1000; // last 24 hours
  });
  const breakingNews = news.filter(n => {
    const ts = (n.datetime || n.publishedDate || 0) * 1000;
    return (now - ts) < cfg.newsFreshness.breaking * 60 * 1000;
  });
  const freshNews = news.filter(n => {
    const ts = (n.datetime || n.publishedDate || 0) * 1000;
    return (now - ts) < cfg.newsFreshness.fresh * 60 * 1000;
  });

  if (breakingNews.length > 0) {
    pts += 8;
    breakdown.push({ factor: 'News Freshness', value: `${breakingNews.length} breaking`, note: 'Breaking news — active catalyst', points: 8 });
  } else if (freshNews.length >= 3) {
    pts += 6;
    breakdown.push({ factor: 'News Freshness', value: `${freshNews.length} fresh`, note: 'High news density', points: 6 });
  } else if (freshNews.length > 0) {
    pts += 3;
    breakdown.push({ factor: 'News Freshness', value: `${freshNews.length} fresh`, note: 'Recent coverage', points: 3 });
  } else if (recentNews.length > 0) {
    pts += 1;
    breakdown.push({ factor: 'News Freshness', value: `${recentNews.length} today`, note: 'Stale — no active catalyst', points: 1 });
  } else {
    breakdown.push({ factor: 'News Freshness', value: 'None', note: 'No recent news', points: 0 });
  }

  // --- 3. Volume Confirmation (0–5) ---
  const callVol = atmCall?.volume || 0;
  const putVol = atmPut?.volume || 0;
  const totalVol = callVol + putVol;
  
  // Use avgVolume20 (stock volume) as a proxy for normal option flow
  if (avgVolume20 && avgVolume20 > 0) {
    // ATM option volume as % of avg stock volume — high ratio = unusual options activity
    const optionIntensity = totalVol / (avgVolume20 / 100); // normalize
    if (optionIntensity >= cfg.volumeSpike.extreme) {
      pts += 5;
      breakdown.push({ factor: 'Volume Confirmation', value: `${totalVol.toLocaleString()} ATM contracts`, note: 'Extreme options activity', points: 5 });
    } else if (optionIntensity >= cfg.volumeSpike.elevated) {
      pts += 3;
      breakdown.push({ factor: 'Volume Confirmation', value: `${totalVol.toLocaleString()} ATM contracts`, note: 'Elevated activity', points: 3 });
    } else if (totalVol > 50) {
      pts += 1;
      breakdown.push({ factor: 'Volume Confirmation', value: `${totalVol.toLocaleString()} ATM contracts`, note: 'Normal flow', points: 1 });
    } else {
      breakdown.push({ factor: 'Volume Confirmation', value: `${totalVol}`, note: 'Low options volume', points: 0 });
    }
  } else {
    // Fallback: just use absolute volume
    if (totalVol > 1000) {
      pts += 4;
      breakdown.push({ factor: 'Volume Confirmation', value: `${totalVol.toLocaleString()}`, note: 'High absolute volume', points: 4 });
    } else if (totalVol > 200) {
      pts += 2;
      breakdown.push({ factor: 'Volume Confirmation', value: `${totalVol.toLocaleString()}`, note: 'Moderate volume', points: 2 });
    } else if (totalVol > 0) {
      pts += 1;
      breakdown.push({ factor: 'Volume Confirmation', value: `${totalVol}`, note: 'Thin volume', points: 1 });
    } else {
      breakdown.push({ factor: 'Volume Confirmation', value: '0', note: 'No volume (off-hours?)', points: 0 });
    }
  }

  // --- 4. News Headline Analysis (0–2) ---
  // Look for high-impact keywords in recent headlines
  const highImpactKeywords = /FDA|earnings|upgrade|downgrade|acquisition|merger|lawsuit|recall|IPO|guidance|buyback|split|dividend|bankruptcy|settlement/i;
  const impactHeadlines = recentNews.filter(n => highImpactKeywords.test(n.headline || n.title || ''));
  if (impactHeadlines.length >= 2) {
    pts += 2;
    breakdown.push({ factor: 'High-Impact Headlines', value: `${impactHeadlines.length} found`, note: 'Multiple material catalysts', points: 2 });
  } else if (impactHeadlines.length === 1) {
    pts += 1;
    breakdown.push({ factor: 'High-Impact Headlines', value: '1 found', note: 'Material headline present', points: 1 });
  } else {
    breakdown.push({ factor: 'High-Impact Headlines', value: 'None', note: 'No material headlines', points: 0 });
  }

  // --- 5. Earnings Quality (± up to 4) ---
  if (earningsSurprisePercent != null) {
    if (earningsSurprisePercent >= 10) {
      pts += 4;
      breakdown.push({ factor: 'Earnings Surprise', value: `+${earningsSurprisePercent.toFixed(1)}%`, note: 'Strong beat — quality catalyst', points: 4 });
    } else if (earningsSurprisePercent >= 3) {
      pts += 3;
      breakdown.push({ factor: 'Earnings Surprise', value: `+${earningsSurprisePercent.toFixed(1)}%`, note: 'Beat — supportive', points: 3 });
    } else if (earningsSurprisePercent >= 0) {
      pts += 1;
      breakdown.push({ factor: 'Earnings Surprise', value: `+${earningsSurprisePercent.toFixed(1)}%`, note: 'Slight beat', points: 1 });
    } else if (earningsSurprisePercent <= -10) {
      pts -= 3;
      breakdown.push({ factor: 'Earnings Surprise', value: `${earningsSurprisePercent.toFixed(1)}%`, note: 'Large miss — weak catalyst', points: -3 });
    } else {
      pts -= 1;
      breakdown.push({ factor: 'Earnings Surprise', value: `${earningsSurprisePercent.toFixed(1)}%`, note: 'Miss — cautious', points: -1 });
    }
  } else {
    breakdown.push({ factor: 'Earnings Surprise', value: 'N/A', note: 'No recent EPS surprise found', points: 0 });
  }

  // --- 6. Earnings Consistency (0–2) ---
  if (earningsBeatsInLast4 != null) {
    if (earningsBeatsInLast4 >= 3) {
      pts += 2;
      breakdown.push({ factor: 'Recent Beats', value: `${earningsBeatsInLast4}/4`, note: 'Consistent beats', points: 2 });
    } else if (earningsBeatsInLast4 === 2) {
      pts += 1;
      breakdown.push({ factor: 'Recent Beats', value: `${earningsBeatsInLast4}/4`, note: 'Mixed earnings history', points: 1 });
    } else {
      breakdown.push({ factor: 'Recent Beats', value: `${earningsBeatsInLast4}/4`, note: 'Few/no recent beats', points: 0 });
    }
  }

  const score = Math.max(0, Math.min(pts, max));

  return { score, max, breakdown };
}

module.exports = { score };
