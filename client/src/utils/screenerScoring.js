export const SCREENER_SCORE_MAX = {
  newsCatalyst: 10,
  technicalSetup: 15,
  liquidity: 15,
  volatility: 10,
  institutionalActivity: 15,
  shortInterest: 10,
  analystSentiment: 15,
  momentum: 10,
};

export const SCREENER_SCORE_LABELS = {
  newsCatalyst: 'News',
  technicalSetup: 'Technicals',
  liquidity: 'Liquidity',
  volatility: 'Volatility',
  institutionalActivity: 'Inst. Activity',
  shortInterest: 'Short Int.',
  analystSentiment: 'Analysts',
  momentum: 'Momentum',
};

export function calcScreenerScore(researchData) {
  const d = researchData;
  const c = d?.company ?? {};
  const s = d?.sentiment ?? {};
  const t = d?.technicals ?? {};
  const n = Array.isArray(d?.news) ? d.news : [];
  const em = d?.expectedMove ?? {};
  const b = {};

  // News Catalyst (max 10)
  let nc = 3;
  if (n.length >= 5) nc += 4;
  else if (n.length >= 2) nc += 2;
  const freshNews = n.filter(item => item.datetime && (Date.now() / 1000 - item.datetime) < 3 * 86400);
  if (freshNews.length > 0) nc += 3;
  b.newsCatalyst = Math.max(0, Math.min(10, nc));

  // Technical Setup (max 15)
  let tech = 7;
  if (t.available) {
    if (t.trend === 'bullish') tech += 4;
    else if (t.trend === 'bearish') tech -= 2;
    if (t.rsi && t.rsi > 30 && t.rsi < 70) tech += 2;
    if (t.distHigh52w != null && t.distHigh52w > -10) tech += 2;
  }
  b.technicalSetup = Math.max(0, Math.min(15, tech));

  // Liquidity (max 15)
  let liq = 5;
  if (c.avgVolume > 2e6) liq += 5;
  else if (c.avgVolume > 500e3) liq += 3;
  else if (c.avgVolume && c.avgVolume < 200e3) liq -= 3;
  if (c.floatShares && c.floatShares < 50e6) liq += 2;
  if (c.marketCap && c.marketCap > 1e9) liq += 3;
  else if (c.marketCap && c.marketCap > 300e6) liq += 1;
  b.liquidity = Math.max(0, Math.min(15, liq));

  // Volatility (max 10)
  let vol = 5;
  if (t.atrPercent != null) {
    if (t.atrPercent > 3 && t.atrPercent < 10) vol += 3;
    else if (t.atrPercent >= 10) vol += 1;
  }
  if (em.available && em.ivPercent) {
    if (em.ivPercent > 30 && em.ivPercent < 100) vol += 2;
  }
  b.volatility = Math.max(0, Math.min(10, vol));

  // Institutional Activity (max 15)
  let inst = 7;
  if (c.institutionalPercent > 60) inst += 3;
  else if (c.institutionalPercent > 30) inst += 1;
  if (c.insiderPercent > 5 && c.insiderPercent < 30) inst += 2;
  const recentInsider = Array.isArray(c.recentInsiderTxns) ? c.recentInsiderTxns : [];
  if (recentInsider.some(tx => (tx.type || '').toLowerCase().includes('purchase'))) inst += 3;
  b.institutionalActivity = Math.max(0, Math.min(15, inst));

  // Short Interest (max 10)
  let si = 3;
  if (c.shortPercentOfFloat > 20) si += 5;
  else if (c.shortPercentOfFloat > 10) si += 3;
  else if (c.shortPercentOfFloat > 5) si += 1;
  if (c.shortRatio > 5) si += 2;
  b.shortInterest = Math.max(0, Math.min(10, si));

  // Analyst Sentiment (max 15)
  let an = 7;
  if (s.recommendationMean) {
    if (s.recommendationMean <= 2.0) an += 4;
    else if (s.recommendationMean <= 2.5) an += 2;
    else if (s.recommendationMean >= 3.5) an -= 2;
  }
  if (s.targetVsPrice > 20) an += 3;
  else if (s.targetVsPrice > 10) an += 1;
  else if (s.targetVsPrice && s.targetVsPrice < -10) an -= 2;
  b.analystSentiment = Math.max(0, Math.min(15, an));

  // Momentum (max 10)
  let mom = 5;
  if (t.available) {
    if (t.aboveSMA20 && t.aboveSMA50) mom += 3;
    else if (t.aboveSMA20) mom += 1;
    if (t.distSMA20 > 0 && t.distSMA20 < 10) mom += 2;
  }
  b.momentum = Math.max(0, Math.min(10, mom));

  const total = Object.values(b).reduce((a, v) => a + v, 0);
  return { score: Math.max(0, Math.min(100, total)), breakdown: b };
}
