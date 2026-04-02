const { supabaseAdmin } = require('../../services/supabaseClient');

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'XLE', 'GLD'];
const HEADLINE_LOOKBACK_HOURS = 24;
const MACRO_PATTERNS = [
  {
    key: 'oil',
    regex: /\b(oil|crude|opec|hormuz|supply)\b/i,
    buildDriver: () => 'Oil rising after supply headlines',
    dominantSector: 'energy',
  },
  {
    key: 'gold',
    regex: /\b(gold|safe haven|treasury|flight to safety)\b/i,
    buildDriver: () => 'Gold bid as safe haven',
    dominantSector: 'commodities',
  },
  {
    key: 'rates',
    regex: /\b(fed|powell|rates?|yields?|inflation|cpi|ppi)\b/i,
    buildDriver: ({ indexData }) => {
      const qqqChange = toNumber(indexData.QQQ?.change_percent, 0);
      return qqqChange <= 0
        ? 'Tech weak due to rates pressure'
        : 'Growth firm despite rates headlines';
    },
    weakSector: 'technology',
  },
  {
    key: 'trade',
    regex: /\b(trump|tariff|trade|geopolitical|war|iran|missile)\b/i,
    buildDriver: ({ indexData }) => {
      const spyChange = toNumber(indexData.SPY?.change_percent, 0);
      return spyChange < 0
        ? 'Risk assets pressured by geopolitical headlines'
        : 'Trade headlines driving rotation across cyclicals';
    },
  },
  {
    key: 'ai',
    regex: /\b(ai|gpu|semiconductor|chip|chips|datacenter)\b/i,
    buildDriver: ({ sectorPerformance, indexData }) => {
      const techStrength = Number(sectorPerformance.find((item) => item.sector === 'technology')?.average_change || 0);
      const qqqChange = toNumber(indexData.QQQ?.change_percent, 0);
      return techStrength >= 0 || qqqChange >= 0
        ? 'Tech leadership supported by AI demand headlines'
        : 'AI complex soft as tech loses momentum';
    },
    dominantSector: 'technology',
  },
];

const SECTOR_MAP = {
  'basic materials': 'materials',
  'communication services': 'communication services',
  'consumer cyclical': 'consumer cyclical',
  'consumer defensive': 'consumer defensive',
  energy: 'energy',
  'financial services': 'financials',
  healthcare: 'healthcare',
  industrials: 'industrials',
  'real estate': 'real estate',
  technology: 'technology',
  utilities: 'utilities',
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSectorName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'other';
  }

  return SECTOR_MAP[normalized] || normalized;
}

function formatPercent(value) {
  const number = toNumber(value, 0);
  const sign = number > 0 ? '+' : '';
  return `${sign}${number.toFixed(1)}%`;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function getSectorPerformance(topMovers = []) {
  const sectorStats = new Map();

  for (const row of topMovers) {
    const sector = normalizeSectorName(row?.sector);
    const current = sectorStats.get(sector) || {
      sector,
      total_change: 0,
      count: 0,
      total_abs_change: 0,
    };

    const change = toNumber(row?.change_percent, 0);
    current.total_change += change;
    current.total_abs_change += Math.abs(change);
    current.count += 1;
    sectorStats.set(sector, current);
  }

  return [...sectorStats.values()]
    .map((entry) => ({
      sector: entry.sector,
      average_change: Number((entry.total_change / Math.max(entry.count, 1)).toFixed(2)),
      average_abs_change: Number((entry.total_abs_change / Math.max(entry.count, 1)).toFixed(2)),
      count: entry.count,
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => {
      if (right.average_change !== left.average_change) {
        return right.average_change - left.average_change;
      }

      return right.average_abs_change - left.average_abs_change;
    });
}

async function fetchIndexData() {
  if (!supabaseAdmin) {
    return {};
  }

  const result = await supabaseAdmin
    .from('market_quotes')
    .select('symbol, price, change_percent, updated_at')
    .in('symbol', INDEX_SYMBOLS);

  if (result.error) {
    throw new Error(result.error.message || 'Failed to load macro index quotes');
  }

  return (result.data || []).reduce((accumulator, row) => {
    accumulator[String(row.symbol || '').toUpperCase()] = {
      symbol: String(row.symbol || '').toUpperCase(),
      price: toNumber(row.price, null),
      change_percent: toNumber(row.change_percent, 0),
      updated_at: row.updated_at || null,
    };
    return accumulator;
  }, {});
}

async function fetchMacroHeadlines() {
  if (!supabaseAdmin) {
    return [];
  }

  const cutoffIso = new Date(Date.now() - HEADLINE_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const result = await supabaseAdmin
    .from('news_articles')
    .select('symbol, headline, published_at')
    .in('symbol', INDEX_SYMBOLS)
    .gte('published_at', cutoffIso)
    .not('published_at', 'is', null)
    .not('headline', 'is', null)
    .order('published_at', { ascending: false })
    .limit(20);

  if (result.error) {
    throw new Error(result.error.message || 'Failed to load macro headlines');
  }

  return (result.data || []).map((item) => ({
    symbol: String(item.symbol || '').toUpperCase(),
    headline: String(item.headline || '').trim(),
    published_at: item.published_at || null,
  })).filter((item) => item.headline);
}

function flattenRecentNews(recentNewsBySymbol) {
  if (!(recentNewsBySymbol instanceof Map)) {
    return [];
  }

  const items = [];
  for (const [symbol, rows] of recentNewsBySymbol.entries()) {
    for (const row of rows || []) {
      if (!row?.headline || !row?.published_at) {
        continue;
      }

      items.push({
        symbol,
        headline: String(row.headline).trim(),
        published_at: row.published_at,
      });
    }
  }

  return items.sort((left, right) => Date.parse(right.published_at || '') - Date.parse(left.published_at || ''));
}

function getHeadlineDrivers(newsHeadlines, sectorPerformance, indexData) {
  const sourceText = uniqueStrings(newsHeadlines.map((item) => item.headline));
  const drivers = [];
  const dominantSectors = [];
  const weakSectors = [];

  for (const pattern of MACRO_PATTERNS) {
    const matchedHeadline = sourceText.find((headline) => pattern.regex.test(headline));
    if (!matchedHeadline) {
      continue;
    }

    drivers.push(pattern.buildDriver({ sectorPerformance, indexData, headline: matchedHeadline }));
    if (pattern.dominantSector) {
      dominantSectors.push(pattern.dominantSector);
    }
    if (pattern.weakSector) {
      weakSectors.push(pattern.weakSector);
    }
  }

  return {
    drivers: uniqueStrings(drivers),
    dominantSectors: uniqueStrings(dominantSectors),
    weakSectors: uniqueStrings(weakSectors),
  };
}

function getRegime(indexData, sectorPerformance) {
  const spyChange = toNumber(indexData.SPY?.change_percent, 0);
  const qqqChange = toNumber(indexData.QQQ?.change_percent, 0);
  const xleChange = toNumber(indexData.XLE?.change_percent, 0);
  const gldChange = toNumber(indexData.GLD?.change_percent, 0);
  const techStrength = Number(sectorPerformance.find((item) => item.sector === 'technology')?.average_change || 0);
  const energyStrength = Number(sectorPerformance.find((item) => item.sector === 'energy')?.average_change || 0);

  let score = 0;
  if (spyChange >= 0.35) score += 2;
  if (spyChange <= -0.35) score -= 2;
  if (qqqChange >= 0.5) score += 2;
  if (qqqChange <= -0.5) score -= 2;
  if (techStrength >= 0.75) score += 1;
  if (techStrength <= -0.75) score -= 1;
  if (energyStrength >= 1 && spyChange <= 0) score -= 1;
  if (gldChange >= 0.6 && spyChange <= 0) score -= 1;
  if (xleChange >= 1 && qqqChange < 0) score -= 1;

  if (score >= 2) return 'risk_on';
  if (score <= -2) return 'risk_off';
  return 'mixed';
}

function buildTapeDrivers(indexData, sectorPerformance, regime) {
  const drivers = [];
  const spyChange = toNumber(indexData.SPY?.change_percent, 0);
  const qqqChange = toNumber(indexData.QQQ?.change_percent, 0);
  const xleChange = toNumber(indexData.XLE?.change_percent, 0);
  const gldChange = toNumber(indexData.GLD?.change_percent, 0);
  const leadingSector = sectorPerformance[0] || null;
  const laggingSector = [...sectorPerformance].reverse()[0] || null;

  if (regime === 'risk_on') {
    drivers.push(`SPY ${formatPercent(spyChange)} with QQQ ${formatPercent(qqqChange)} driving a risk-on tape`);
  } else if (regime === 'risk_off') {
    drivers.push(`SPY ${formatPercent(spyChange)} while QQQ ${formatPercent(qqqChange)} keeps pressure on the tape`);
  } else {
    drivers.push(`SPY ${formatPercent(spyChange)} while QQQ trades ${formatPercent(qqqChange)} in a split tape`);
  }

  if (leadingSector) {
    drivers.push(`${leadingSector.sector} leading at ${formatPercent(leadingSector.average_change)}`);
  }

  if (laggingSector && laggingSector.sector !== leadingSector?.sector) {
    drivers.push(`${laggingSector.sector} lagging at ${formatPercent(laggingSector.average_change)}`);
  }

  if (xleChange >= 0.8) {
    drivers.push(`Energy strength confirmed by XLE ${formatPercent(xleChange)}`);
  }

  if (gldChange >= 0.5) {
    drivers.push(`GLD ${formatPercent(gldChange)} as defensives catch a bid`);
  }

  return uniqueStrings(drivers);
}

function limitDriverCount(drivers) {
  return uniqueStrings(drivers)
    .filter((driver) => driver.length >= 12)
    .slice(0, 3);
}

function excludeOverlap(primaryList, secondaryList) {
  const primary = new Set(primaryList);
  return secondaryList.filter((item) => !primary.has(item));
}

async function buildMacroContext({ topMovers = [], recentNewsBySymbol = new Map() } = {}) {
  const sectorPerformance = getSectorPerformance(topMovers);
  const [indexData, indexHeadlines] = await Promise.all([
    fetchIndexData().catch(() => ({})),
    fetchMacroHeadlines().catch(() => []),
  ]);
  const moverHeadlines = flattenRecentNews(recentNewsBySymbol).slice(0, 30);
  const newsHeadlines = [...indexHeadlines, ...moverHeadlines];
  const headlineDrivers = getHeadlineDrivers(newsHeadlines, sectorPerformance, indexData);
  const regime = getRegime(indexData, sectorPerformance);

  const dominantSectors = uniqueStrings([
    ...headlineDrivers.dominantSectors,
    ...sectorPerformance.filter((entry) => entry.average_change >= 0.8).slice(0, 2).map((entry) => entry.sector),
  ]).slice(0, 3);

  const weakSectors = excludeOverlap(dominantSectors, uniqueStrings([
    ...headlineDrivers.weakSectors,
    ...sectorPerformance.filter((entry) => entry.average_change <= -0.8).slice(0, 2).map((entry) => entry.sector),
  ])).slice(0, 3);

  const fallbackDrivers = buildTapeDrivers(indexData, sectorPerformance, regime);
  const drivers = limitDriverCount([...headlineDrivers.drivers, ...fallbackDrivers]);

  return {
    regime,
    drivers: drivers.length > 0 ? drivers : [`SPY ${formatPercent(toNumber(indexData.SPY?.change_percent, 0))} while QQQ trades ${formatPercent(toNumber(indexData.QQQ?.change_percent, 0))}`],
    dominant_sectors: dominantSectors.length > 0 ? dominantSectors : ['technology'],
    weak_sectors: weakSectors.length > 0 ? weakSectors : (regime === 'risk_off' ? ['technology'] : ['utilities']),
  };
}

module.exports = {
  buildMacroContext,
  normalizeSectorName,
};