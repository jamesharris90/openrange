function normalizeHeadline(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getDirection(changePercent) {
  const value = Number(changePercent || 0);
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

function detectMacroKeyword(headline) {
  const normalized = normalizeHeadline(headline).toLowerCase();
  if (!normalized) return null;

  const keywordMap = [
    { match: 'fed', label: 'Fed policy' },
    { match: 'rates', label: 'rates' },
    { match: 'inflation', label: 'inflation' },
    { match: 'trump', label: 'Trump policy' },
    { match: 'oil', label: 'oil' },
    { match: 'war', label: 'war risk' },
  ];

  for (const entry of keywordMap) {
    if (normalized.includes(entry.match)) {
      return entry;
    }
  }

  return null;
}

function isWithinHours(timestamp, hours) {
  const parsed = Date.parse(timestamp || '');
  if (Number.isNaN(parsed)) return false;
  return (Date.now() - parsed) <= hours * 60 * 60 * 1000;
}

function getDaysFromToday(dateValue) {
  const parsed = Date.parse(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;
  return Math.round((parsed - Date.now()) / 86400000);
}

async function buildWhy(symbol, row, context = {}) {
  const recentNewsBySymbol = context.recentNewsBySymbol || new Map();
  const dbEarningsBySymbol = context.dbEarningsBySymbol || new Map();
  const rows = Array.isArray(context.rows) ? context.rows : [];
  const sector = row?.sector || null;
  const direction = getDirection(row?.change_percent);
  const recentNews = recentNewsBySymbol.get(symbol) || [];
  const latestNews = recentNews[0] || null;
  const dbEarningsDate = dbEarningsBySymbol.get(symbol) || null;

  if (dbEarningsDate) {
    const dayDiff = getDaysFromToday(dbEarningsDate);
    if (dayDiff !== null && Math.abs(dayDiff) <= 5) {
      return {
        why: dayDiff >= 0 ? 'Pre-earnings positioning ahead of report' : 'Post-earnings reaction around recent report',
        driver_type: 'EARNINGS',
        confidence: 0.92,
      };
    }
  }

  if (latestNews && isWithinHours(latestNews.published_at, 72)) {
    const macroKeyword = detectMacroKeyword(latestNews.headline);
    if (macroKeyword) {
      return {
        why: `${sector || 'Sector'} moving after macro news on ${macroKeyword.label}`,
        driver_type: 'MACRO',
        confidence: 0.9,
      };
    }
  }

  const sectorPeers = rows.filter((candidate) => candidate.symbol !== symbol && candidate.sector && candidate.sector === sector);
  const alignedSectorPeers = sectorPeers.filter((candidate) => getDirection(candidate.change_percent) === direction && Math.abs(candidate.change_percent || 0) >= 2);
  const sectorPeersWithFreshNews = alignedSectorPeers.filter((candidate) => {
    const peerNews = recentNewsBySymbol.get(candidate.symbol) || [];
    return peerNews.some((item) => isWithinHours(item.published_at, 72));
  });

  if (sector && sectorPeersWithFreshNews.length >= 2) {
    const sectorMacro = sectorPeersWithFreshNews
      .flatMap((candidate) => recentNewsBySymbol.get(candidate.symbol) || [])
      .map((item) => detectMacroKeyword(item.headline))
      .find(Boolean);

    if (sectorMacro) {
      return {
        why: `${sector} stocks moving together on ${sectorMacro.label}`,
        driver_type: 'MACRO',
        confidence: 0.84,
      };
    }

    return {
      why: `${sector} stocks moving together on shared industry headlines`,
      driver_type: 'SECTOR',
      confidence: 0.78,
    };
  }

  if (latestNews && isWithinHours(latestNews.published_at, 72)) {
    return {
      why: 'Stock moving on company-specific announcement',
      driver_type: 'NEWS',
      confidence: 0.82,
    };
  }

  if ((row?.rvol ?? 0) > 2 && Math.abs(row?.change_percent ?? 0) > 5) {
    return {
      why: 'High volume breakout with no clear catalyst',
      driver_type: 'TECHNICAL',
      confidence: 0.64,
    };
  }

  return {
    why: 'Price moving without a clear external catalyst',
    driver_type: 'TECHNICAL',
    confidence: 0.4,
  };
}

module.exports = {
  buildWhy,
};
