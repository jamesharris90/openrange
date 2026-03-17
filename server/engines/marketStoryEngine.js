function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function directionWord(spy, qqq) {
  if (Number.isFinite(spy) && Number.isFinite(qqq)) {
    if (spy >= 0.6 || qqq >= 0.6) return 'higher';
    if (spy <= -0.6 || qqq <= -0.6) return 'lower';
  }
  return 'mixed';
}

function riskSentence(vix) {
  if (!Number.isFinite(vix)) {
    return 'Risk context: volatility signals are mixed, so traders should prioritize confirmation over anticipation.';
  }
  if (vix >= 25) {
    return 'Risk context: elevated volatility keeps intraday risk high, so tighter sizing and disciplined stops remain essential.';
  }
  if (vix <= 16) {
    return 'Risk context: volatility is contained, but traders should still respect failed breakouts around key levels.';
  }
  return 'Risk context: volatility is balanced, supporting selective momentum while requiring disciplined risk control.';
}

function dominantSector(topMovers = []) {
  const counts = new Map();
  for (const row of topMovers || []) {
    const sector = String(row?.sector || '').trim();
    if (!sector) continue;
    counts.set(sector, (counts.get(sector) || 0) + 1);
  }

  let best = null;
  for (const [sector, count] of counts.entries()) {
    if (!best || count > best.count) {
      best = { sector, count };
    }
  }
  return best;
}

function generateMarketStory({ SPY, QQQ, VIX, topMovers = [], radarThemes = [] } = {}) {
  const spy = toNumber(SPY);
  const qqq = toNumber(QQQ);
  const vix = toNumber(VIX);
  const direction = directionWord(spy, qqq);
  const themes = (radarThemes || []).filter(Boolean);
  const lead = dominantSector(topMovers);

  if (themes.length > 0) {
    const sector = lead?.sector || 'leading';
    return [
      `US equities are trading ${direction} today with leadership emerging in the ${sector} sector, where several stocks are showing elevated participation.`,
      'If this participation continues it may signal short term momentum opportunities.',
      riskSentence(vix),
    ].join(' ');
  }

  return [
    'Markets are trading without clear sector leadership today. While several stocks are showing isolated momentum, participation across the broader market remains mixed.',
    riskSentence(vix),
  ].join(' ');
}

module.exports = {
  generateMarketStory,
};
