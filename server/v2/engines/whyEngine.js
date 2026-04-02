const GENERIC_WORDS = new Set([
  'after',
  'amid',
  'analyst',
  'announces',
  'company',
  'comments',
  'drops',
  'falls',
  'gain',
  'gains',
  'higher',
  'jump',
  'jumps',
  'lower',
  'market',
  'moves',
  'news',
  'outlook',
  'report',
  'shares',
  'stock',
  'stocks',
  'surges',
  'today',
  'update',
]);

const SECTOR_LABELS = {
  'Basic Materials': 'Materials',
  'Communication Services': 'Media',
  'Consumer Cyclical': 'Retail',
  'Consumer Defensive': 'Staples',
  Energy: 'Oil',
  'Financial Services': 'Financials',
  Healthcare: 'Healthcare',
  Industrials: 'Industrial',
  'Real Estate': 'REIT',
  Technology: 'Tech',
  Utilities: 'Utility',
};

function normalizeHeadline(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getDirection(changePercent) {
  const value = Number(changePercent || 0);
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

function getMoveVerb(changePercent) {
  const direction = getDirection(changePercent);
  if (direction === 'up') return 'rising';
  if (direction === 'down') return 'falling';
  return 'moving';
}

function isWithinHours(timestamp, hours) {
  const parsed = Date.parse(timestamp || '');
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= hours * 60 * 60 * 1000;
}

function getDaysFromToday(dateValue) {
  const parsed = Date.parse(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;
  return Math.round((parsed - Date.now()) / 86400000);
}

function limitWords(text, maxWords) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(' ')
    .trim();
}

function titleCase(word) {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function extractFallbackTokens(headline) {
  return normalizeHeadline(headline)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !GENERIC_WORDS.has(token));
}

function isGenericHeadline(headline) {
  const normalized = normalizeHeadline(headline).toLowerCase();
  if (!normalized) return true;

  return (
    normalized.includes('most active stocks') ||
    normalized.includes('stock market today') ||
    normalized.includes('heard on the street')
  );
}

function buildKeywordEntry(key, label, context, isMacro) {
  return { key, label, context, isMacro };
}

function extractKeywords(headline) {
  const normalized = normalizeHeadline(headline).toLowerCase();
  if (!normalized) return [];

  const keywords = [];
  const seen = new Set();
  const pushKeyword = (entry) => {
    if (!entry || seen.has(entry.key)) return;
    seen.add(entry.key);
    keywords.push(entry);
  };

  if (/\btrump\b/.test(normalized) && /(supply|oil|crude|opec|tariff|trade)/.test(normalized)) {
    pushKeyword(buildKeywordEntry('trump_supply', 'Trump', 'Trump supply comments', true));
  } else if (/\btrump\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('trump', 'Trump', 'Trump comments', true));
  }

  if (/\b(fed|powell|rates?)\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('fed', 'Fed', 'Fed policy comments', true));
  }

  if (/\b(inflation|cpi|ppi)\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('inflation', 'Inflation', 'inflation data', true));
  }

  if (/\b(oil|crude|opec|hormuz|supply)\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('oil', 'Oil', 'oil supply headlines', true));
  }

  if (/\b(war|iran|middle east|geopolitical|missile)\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('geopolitics', 'Geopolitics', 'geopolitical headlines', true));
  }

  if (/\b(ai|gpu|semiconductor|chip|chips|datacenter)\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('ai', 'AI', 'AI demand headlines', false));
  }

  if (/\b(reverse split|share split|share consolidation|consolidation)\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('split', 'Split', 'reverse split news', false));
  }

  if (/\b(offering|registered direct|public offering|pricing)\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('offering', 'Offering', 'offering news', false));
  }

  if (/\b(strategy|expansion|rollout|production)\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('strategy', 'Strategy', 'growth strategy update', false));
  }

  if (/\b(earnings|guidance|results|forecast|quarter)\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('earnings', 'Earnings', 'earnings update', false));
  }

  if (/\b(drug|trial|fda|approval|therapy)\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('drug', 'Drug', 'drug trial headlines', false));
  }

  if (/\b(contract|deal|partnership|order|launch)\b/.test(normalized)) {
    pushKeyword(buildKeywordEntry('contract', 'Contract', 'contract win headlines', false));
  }

  if (keywords.length === 0) {
    const fallbackToken = extractFallbackTokens(normalized)[0] || 'headline';
    pushKeyword(buildKeywordEntry(fallbackToken, titleCase(fallbackToken), `${fallbackToken} headlines`, false));
  }

  return keywords;
}

function getSectorLabel(sector) {
  if (!sector) return 'Sector';
  return SECTOR_LABELS[sector] || sector;
}

function getLinkedSymbols(row, rows) {
  if (!row?.symbol || !row?.sector) return [];

  const direction = getDirection(row.change_percent);
  return rows
    .filter((candidate) => {
      if (!candidate?.symbol || candidate.symbol === row.symbol) return false;
      if (!candidate.sector || candidate.sector !== row.sector) return false;
      if (direction !== 'flat' && getDirection(candidate.change_percent) !== direction) return false;
      return Math.abs(candidate.change_percent ?? 0) >= 0.5;
    })
    .sort((left, right) => {
      const leftGap = Math.abs(Math.abs(left.change_percent ?? 0) - Math.abs(row.change_percent ?? 0));
      const rightGap = Math.abs(Math.abs(right.change_percent ?? 0) - Math.abs(row.change_percent ?? 0));
      if (leftGap !== rightGap) return leftGap - rightGap;
      return Math.abs(right.change_percent ?? 0) - Math.abs(left.change_percent ?? 0);
    })
    .slice(0, 3)
    .map((candidate) => candidate.symbol);
}

function getPrimaryNewsItem(newsItems) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    return null;
  }

  return newsItems.find((item) => !isGenericHeadline(item.headline)) || newsItems[0] || null;
}

function getThemeStrength(symbol, row, context) {
  const recentNewsBySymbol = context.recentNewsBySymbol || new Map();
  const rows = Array.isArray(context.rows) ? context.rows : [];
  const direction = getDirection(row?.change_percent);
  const alignedRows = rows.filter((candidate) => {
    if (!candidate?.symbol || !candidate?.sector || candidate.sector !== row?.sector) return false;
    if (getDirection(candidate.change_percent) !== direction) return false;
    return Math.abs(candidate.change_percent ?? 0) >= 2;
  });

  const keywordStats = new Map();
  for (const candidate of alignedRows) {
    const latestHeadline = (recentNewsBySymbol.get(candidate.symbol) || [])[0]?.headline;
    if (!latestHeadline) continue;

    const candidateKeywords = extractKeywords(latestHeadline);
    const candidateSeen = new Set();
    for (const keyword of candidateKeywords) {
      if (candidateSeen.has(keyword.key)) continue;
      candidateSeen.add(keyword.key);

      const current = keywordStats.get(keyword.key) || {
        keyword,
        count: 0,
        symbols: [],
      };

      current.count += 1;
      current.symbols.push(candidate.symbol);
      keywordStats.set(keyword.key, current);
    }
  }

  const strongestTheme = [...keywordStats.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return Number(right.keyword.isMacro) - Number(left.keyword.isMacro);
  })[0] || null;

  return {
    alignedRows,
    strongestTheme,
  };
}

function buildWhyText(subject, verb, contextText) {
  return limitWords(`${subject} ${verb} after ${contextText}`, 12);
}

function getConfidence(row, latestNews, themeCount, earningsDate) {
  let confidence = 0;
  if (latestNews && isWithinHours(latestNews.published_at, 24)) {
    confidence += 0.4;
  }
  if (themeCount >= 3) {
    confidence += 0.3;
  }
  if ((row?.rvol ?? 0) > 2) {
    confidence += 0.2;
  }
  if (earningsDate) {
    const dayDiff = getDaysFromToday(earningsDate);
    if (dayDiff !== null && Math.abs(dayDiff) <= 5) {
      confidence += 0.1;
    }
  }

  return Math.min(1, Number(confidence.toFixed(2)));
}

async function buildWhy(symbol, row, context = {}) {
  const recentNewsBySymbol = context.recentNewsBySymbol || new Map();
  const dbEarningsBySymbol = context.dbEarningsBySymbol || new Map();
  const rows = Array.isArray(context.rows) ? context.rows : [];
  const sectorLabel = getSectorLabel(row?.sector);
  const verb = getMoveVerb(row?.change_percent);
  const recentNews = recentNewsBySymbol.get(symbol) || [];
  const latestNews = getPrimaryNewsItem(recentNews);
  const latestKeywords = latestNews ? extractKeywords(latestNews.headline) : [];
  const primaryKeyword = latestKeywords[0] || null;
  const earningsDate = dbEarningsBySymbol.get(symbol) || null;
  const linkedSymbols = getLinkedSymbols(row, rows);
  const themeStrength = getThemeStrength(symbol, row, context);
  const themeCount = themeStrength.strongestTheme?.count || 0;
  const confidence = getConfidence(row, latestNews, themeCount, earningsDate);

  if (earningsDate) {
    const dayDiff = getDaysFromToday(earningsDate);
    if (dayDiff !== null && Math.abs(dayDiff) <= 5) {
      const timing = dayDiff >= 0 ? 'earnings setup' : 'earnings reaction';
      return {
        why: buildWhyText(symbol, verb, timing),
        driver_type: 'EARNINGS',
        confidence,
        linked_symbols: linkedSymbols,
      };
    }
  }

  if (
    row?.sector &&
    themeStrength.strongestTheme &&
    themeStrength.strongestTheme.keyword.isMacro &&
    themeStrength.strongestTheme.count >= 5 &&
    themeStrength.alignedRows.length >= 5
  ) {
    return {
      why: buildWhyText(`${themeStrength.strongestTheme.keyword.label} stocks`, verb, themeStrength.strongestTheme.keyword.context),
      driver_type: 'MACRO',
      confidence,
      linked_symbols: linkedSymbols,
    };
  }

  if (row?.sector && themeStrength.strongestTheme && themeStrength.strongestTheme.count >= 3) {
    return {
      why: buildWhyText(`${sectorLabel} stocks`, verb, themeStrength.strongestTheme.keyword.context),
      driver_type: 'SECTOR',
      confidence,
      linked_symbols: linkedSymbols,
    };
  }

  if (latestNews && primaryKeyword) {
    return {
      why: buildWhyText(symbol, verb, primaryKeyword.context),
      driver_type: 'NEWS',
      confidence,
      linked_symbols: linkedSymbols,
    };
  }

  if ((row?.rvol ?? 0) > 2 && getDirection(row?.change_percent) === 'up') {
    return {
      why: buildWhyText(symbol, verb, 'heavy volume breakout'),
      driver_type: 'TECHNICAL',
      confidence,
      linked_symbols: linkedSymbols,
    };
  }

  if ((row?.rvol ?? 0) > 2 && getDirection(row?.change_percent) === 'down') {
    return {
      why: buildWhyText(symbol, verb, 'heavy volume selloff'),
      driver_type: 'TECHNICAL',
      confidence,
      linked_symbols: linkedSymbols,
    };
  }

  if (linkedSymbols.length >= 2 && row?.sector) {
    return {
      why: buildWhyText(`${sectorLabel} stocks`, verb, 'peer momentum'),
      driver_type: 'TECHNICAL',
      confidence,
      linked_symbols: linkedSymbols,
    };
  }

  return {
    why: row?.sector
      ? buildWhyText(`${sectorLabel} stocks`, verb, 'sector rotation')
      : buildWhyText(symbol, verb, 'order-flow imbalance'),
    driver_type: 'TECHNICAL',
    confidence,
    linked_symbols: linkedSymbols,
  };
}

module.exports = {
  buildWhy,
};