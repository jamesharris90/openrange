const WEIGHTS = Object.freeze({
  catalyst: 0.30,
  gap: 0.20,
  volume: 0.25,
  structure: 0.15,
  regime: 0.10,
});

const totalWeight = Object.values(WEIGHTS).reduce((total, value) => total + value, 0);
if (Math.abs(totalWeight - 1) > 1e-9) {
  throw new Error(`Premarket catalyst weights must sum to 1.0, received ${totalWeight}`);
}

const GAP_ANCHORS = [
  [2, 0],
  [4, 60],
  [8, 100],
  [15, 65],
  [25, 25],
  [30, 0],
];

const RVOL_ANCHORS = [
  [1, 0],
  [2, 30],
  [3, 50],
  [5, 75],
  [10, 100],
];

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function interpolateAnchors(value, anchors) {
  if (!Number.isFinite(value)) return 0;
  if (value <= anchors[0][0]) return anchors[0][1];
  if (value >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1];

  for (let index = 1; index < anchors.length; index += 1) {
    const [currentX, currentY] = anchors[index];
    const [previousX, previousY] = anchors[index - 1];
    if (value <= currentX) {
      const ratio = (value - previousX) / (currentX - previousX);
      return previousY + (currentY - previousY) * ratio;
    }
  }

  return 0;
}

function extractTimestamp(record) {
  const rawValue = record?.accepted_date
    || record?.acceptedDate
    || record?.published_at
    || record?.published_date
    || record?.publishedAt
    || record?.filing_date
    || record?.filingDate
    || record?.updated_at
    || record?.timestamp;

  if (!rawValue) return null;
  const date = new Date(rawValue);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isWithinHours(record, now, hours = 24) {
  const timestamp = extractTimestamp(record);
  if (!timestamp) return false;
  return (now.getTime() - timestamp.getTime()) <= hours * 60 * 60 * 1000;
}

function detectNewsCatalyst(article) {
  const normalizedType = String(article?.catalyst_type || article?.catalyst_cluster || '').trim().toLowerCase();
  const haystack = [
    article?.headline,
    article?.title,
    article?.summary,
    article?.body_text,
    article?.narrative,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/fda approval|approved by the fda|phase 3 success/.test(haystack)) {
    return { score: 100, type: 'fda_approval', summary: article?.headline || article?.title || 'FDA approval catalyst', source: article?.source || article?.publisher || null, timestamp: extractTimestamp(article) };
  }

  if (/merger agreement|to acquire|acquisition of|buyout|merger/.test(haystack)) {
    return { score: 100, type: 'mna', summary: article?.headline || article?.title || 'M&A catalyst', source: article?.source || article?.publisher || null, timestamp: extractTimestamp(article) };
  }

  if (/contract award|major contract|awarded.*contract|partnership/.test(haystack)) {
    return { score: 100, type: 'contract', summary: article?.headline || article?.title || 'Major contract catalyst', source: article?.source || article?.publisher || null, timestamp: extractTimestamp(article) };
  }

  if (normalizedType.includes('analyst') || /upgrade|downgrade|price target|initiates coverage/.test(haystack)) {
    return { score: 70, type: 'analyst', summary: article?.headline || article?.title || 'Analyst catalyst', source: article?.source || article?.publisher || null, timestamp: extractTimestamp(article) };
  }

  if (/guidance raise|guidance cut|raises guidance|cuts guidance|outlook/.test(haystack)) {
    return { score: 70, type: 'guidance', summary: article?.headline || article?.title || 'Guidance catalyst', source: article?.source || article?.publisher || null, timestamp: extractTimestamp(article) };
  }

  if (normalizedType) {
    return { score: 40, type: normalizedType, summary: article?.headline || article?.title || 'Tracked catalyst', source: article?.source || article?.publisher || null, timestamp: extractTimestamp(article) };
  }

  return null;
}

function detectFilingCatalyst(filing) {
  const formType = String(filing?.form_type || filing?.formType || '').trim().toUpperCase();
  if (!formType) return null;

  if (formType === '8-K') {
    return { score: 70, type: '8-K', summary: 'Recent 8-K filing', source: 'sec_filings', timestamp: extractTimestamp(filing) };
  }

  if (formType === '10-K' || formType === '10-Q') {
    return { score: 100, type: formType, summary: `Recent ${formType} filing`, source: 'sec_filings', timestamp: extractTimestamp(filing) };
  }

  if (/^13D|^13G/.test(formType)) {
    return { score: 40, type: formType, summary: `Recent ${formType} filing`, source: 'sec_filings', timestamp: extractTimestamp(filing) };
  }

  return null;
}

function deriveCatalystSignal({ newsArticles = [], secFilings = [], earningsEvents = [], now = new Date() }) {
  const referenceTime = now instanceof Date ? now : new Date(now);
  const candidates = [];

  const recentEarnings = (earningsEvents || []).filter((event) => {
    const reportDateRaw = event?.report_date || event?.earnings_date;
    if (!reportDateRaw) return false;
    const reportDate = new Date(`${String(reportDateRaw).slice(0, 10)}T00:00:00.000Z`);
    if (!Number.isFinite(reportDate.getTime())) return false;
    const diffHours = Math.abs(referenceTime.getTime() - reportDate.getTime()) / (60 * 60 * 1000);
    return diffHours <= 24;
  });

  if (recentEarnings.length > 0) {
    const event = recentEarnings[0];
    candidates.push({
      score: 100,
      type: 'earnings',
      summary: `Earnings event ${event?.report_time || event?.time || 'scheduled'}`,
      source: 'earnings_events',
      timestamp: extractTimestamp({ timestamp: `${String(event?.report_date || event?.earnings_date).slice(0, 10)}T00:00:00.000Z` }),
    });
  }

  for (const article of newsArticles || []) {
    if (!isWithinHours(article, referenceTime, 24)) continue;
    const candidate = detectNewsCatalyst(article);
    if (candidate) candidates.push(candidate);
  }

  for (const filing of secFilings || []) {
    if (!isWithinHours(filing, referenceTime, 24)) continue;
    const candidate = detectFilingCatalyst(filing);
    if (candidate) candidates.push(candidate);
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return (right.timestamp?.getTime() || 0) - (left.timestamp?.getTime() || 0);
  });

  return candidates[0] || {
    score: 0,
    type: null,
    summary: null,
    source: null,
    timestamp: null,
  };
}

function scoreCatalyst({ newsArticles = [], secFilings = [], earningsEvents = [], now = new Date() }) {
  return deriveCatalystSignal({ newsArticles, secFilings, earningsEvents, now }).score;
}

function scoreGap({ premarketPrice, previousClose }) {
  const price = toNumber(premarketPrice);
  const close = toNumber(previousClose);
  if (price === null || close === null || close <= 0) return 0;

  const gapPercent = Math.abs(((price - close) / close) * 100);
  if (gapPercent < 2 || gapPercent > 30) return 0;
  return clamp(interpolateAnchors(gapPercent, GAP_ANCHORS));
}

function scoreVolume({ premarketVolume, premarketVolumeBaseline }) {
  const volume = toNumber(premarketVolume);
  const baseline = toNumber(premarketVolumeBaseline);
  if (volume === null || baseline === null || baseline <= 0) return 0;

  const rvol = volume / baseline;
  if (rvol <= 1) return 0;
  if (rvol >= 10) return 100;
  return clamp(interpolateAnchors(rvol, RVOL_ANCHORS));
}

function hasHigherLows(premarketBars = []) {
  const recentBars = (premarketBars || []).slice(-5);
  if (recentBars.length < 5) return false;
  for (let index = 1; index < recentBars.length; index += 1) {
    const previousLow = toNumber(recentBars[index - 1]?.low);
    const currentLow = toNumber(recentBars[index]?.low);
    if (previousLow === null || currentLow === null || currentLow <= previousLow) {
      return false;
    }
  }
  return true;
}

function scoreStructure({ premarketBars = [], premarketHigh, premarketVwap, currentPrice }) {
  const high = toNumber(premarketHigh);
  const vwap = toNumber(premarketVwap);
  const price = toNumber(currentPrice);
  if (high === null || vwap === null || price === null || high <= 0) return 0;

  const nearHighDistance = ((high - price) / high) * 100;
  const higherLows = hasHigherLows(premarketBars);

  if (price > vwap && nearHighDistance <= 1 && higherLows) return 100;
  if (price > vwap && nearHighDistance <= 2) return 70;
  if (price > vwap) return 50;
  if (Math.abs((price - vwap) / vwap) * 100 <= 0.5) return 30;

  const lows = (premarketBars || []).map((bar) => toNumber(bar?.low)).filter((value) => value !== null);
  const low = lows.length ? Math.min(...lows) : null;
  const midrange = low !== null ? (high + low) / 2 : vwap;
  if (price < vwap && price < midrange) return 0;

  return 30;
}

function scoreRegime({ marketContext, ticker = {} }) {
  const regime = marketContext?.marketRegime || 'neutral';
  const sectors = marketContext?.sectors || {};
  const sectorKey = ticker?.sectorSymbol || ticker?.sectorEtf || ticker?.sector || null;
  const sectorEntry = sectorKey ? sectors[sectorKey] : null;
  const totalSectors = Object.keys(sectors).length || 0;
  const sectorRank = sectorEntry?.rank ?? null;
  const sectorChange = toNumber(sectorEntry?.changePercent);
  const isTopThree = sectorRank !== null && sectorRank <= 3;
  const isBottomThree = sectorRank !== null && totalSectors >= 3 && sectorRank >= (totalSectors - 2);
  const isPositive = sectorChange !== null && sectorChange > 0;

  if (regime === 'risk_on') {
    if (isTopThree) return 100;
    return 75;
  }

  if (regime === 'risk_off') {
    if (isBottomThree) return 0;
    if (isPositive) return 25;
    return 10;
  }

  if (isPositive) return 60;
  return 50;
}

function computeCompositeScore({ catalystScore = 0, gapScore = 0, volumeScore = 0, structureScore = 0, regimeScore = 0 }) {
  return clamp(
    (toNumber(catalystScore) || 0) * WEIGHTS.catalyst
      + (toNumber(gapScore) || 0) * WEIGHTS.gap
      + (toNumber(volumeScore) || 0) * WEIGHTS.volume
      + (toNumber(structureScore) || 0) * WEIGHTS.structure
      + (toNumber(regimeScore) || 0) * WEIGHTS.regime
  );
}

module.exports = {
  WEIGHTS,
  deriveCatalystSignal,
  scoreCatalyst,
  scoreGap,
  scoreVolume,
  scoreStructure,
  scoreRegime,
  computeCompositeScore,
};
