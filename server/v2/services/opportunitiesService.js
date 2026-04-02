const { getScreenerRows } = require('./screenerService');
const { buildNarrative } = require('./narrativeService');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getNewsRecencyScore(publishedAt) {
  const parsed = Date.parse(String(publishedAt || ''));
  if (Number.isNaN(parsed)) {
    return 0;
  }

  const ageHours = Math.max(0, (Date.now() - parsed) / 3600000);
  if (ageHours <= 1) return 1;
  if (ageHours <= 6) return 0.85;
  if (ageHours <= 24) return 0.65;
  if (ageHours <= 72) return 0.35;
  return 0;
}

function getEarningsProximityScore(earningsDate) {
  if (!earningsDate) {
    return 0;
  }

  const parsed = Date.parse(`${earningsDate}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return 0;
  }

  const dayDiff = Math.abs(Math.round((parsed - Date.now()) / 86400000));
  if (dayDiff <= 1) return 1;
  if (dayDiff <= 3) return 0.8;
  if (dayDiff <= 7) return 0.5;
  return 0;
}

function getRvolNormalized(rvol) {
  return clamp(toNumber(rvol, 0) / 5, 0, 1);
}

function getChangeNormalized(changePercent) {
  return clamp(Math.abs(toNumber(changePercent, 0)) / 10, 0, 1);
}

function scoreOpportunity(row) {
  const confidence = clamp(toNumber(row.confidence, 0), 0, 1);
  const score = (
    (confidence * 40)
    + (getRvolNormalized(row.rvol) * 25)
    + (getChangeNormalized(row.change_percent) * 15)
    + (getNewsRecencyScore(row.latest_news_at) * 10)
    + (getEarningsProximityScore(row.earnings_date) * 10)
  );

  return Number(clamp(score, 0, 100).toFixed(2));
}

function buildOpportunityWhy(symbol, narrative, row) {
  const rvolValue = toNumber(row?.rvol, 0);
  const hasFreshNews = getNewsRecencyScore(row?.latest_news_at) >= 0.65;
  const driverType = String(row?.driver_type || '').toUpperCase();
  const setupType = String(narrative.setup_type || '').trim();

  let reason = 'low-conviction tape';
  if (setupType === 'breakout') {
    reason = hasFreshNews
      ? 'high RVOL news-driven continuation'
      : 'high RVOL directional expansion';
  } else if (setupType === 'momentum continuation') {
    reason = driverType === 'EARNINGS'
      ? 'earnings-backed continuation flow'
      : 'trend continuation with flow support';
  } else if (setupType === 'fade') {
    reason = 'extended move with fade risk';
  } else if (setupType === 'mean reversion') {
    reason = 'stretched move near reversion territory';
  } else if (rvolValue >= 2) {
    reason = 'active tape without clean confirmation';
  }

  return `${symbol} — ${setupType} + ${reason}`;
}

async function getOpportunityRows() {
  const { rows } = await getScreenerRows();
  const candidates = (rows || []).filter((row) => row?.symbol)
    .filter((row) => toNumber(row.confidence, 0) >= 0.6)
    .filter((row) => toNumber(row.rvol, 0) > 1.5);

  const enriched = [];
  for (const row of candidates) {
    const narrative = await buildNarrative(row.symbol, row);
    if (!narrative.tradeable) {
      continue;
    }

    enriched.push({
      symbol: row.symbol,
      score: scoreOpportunity(row),
      why: buildOpportunityWhy(row.symbol, narrative, row),
      bias: narrative.bias,
      risk: narrative.risk,
      confidence_reason: narrative.confidence_reason,
      setup_type: narrative.setup_type,
      watch: narrative.watch,
      confidence: Number(toNumber(row.confidence, 0).toFixed(2)),
      tradeable: narrative.tradeable,
    });
  }

  return enriched
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      return String(left.symbol).localeCompare(String(right.symbol));
    })
    .slice(0, 5);
}

module.exports = {
  getOpportunityRows,
};