const { queryWithTimeout } = require('../../db/pg');

const TITLE_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'in', 'into', 'is', 'it',
  'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'will', 'with', 'why', 'could', 'should',
  'would', 'after', 'before', 'amid', 'over', 'under', 'more', 'than', 'how', 'what', 'when', 'where', 'your',
  'about', 'market', 'stocks', 'stock', 'shares', 'today', 'week', 'month', 'best', 'top', 'surge', 'rise', 'falls',
]);

const GENERIC_THEME_TOKENS = new Set([
  'earnings', 'guidance', 'eps', 'fed', 'cpi', 'rates', 'treasury', 'market', 'stock', 'stocks', 'share', 'shares',
]);

const EARNINGS_RE = /\b(earnings|eps|guidance)\b/i;
const MACRO_RE = /\b(fed|cpi|inflation|rates?|treasury|yield|futures|oil|crude|gold|market|markets|economy|economic|nasdaq|dow|s&p|volatility)\b/i;
const MARKET_SYMBOLS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'VIX', 'TLT', 'GLD', 'USO']);
const MAX_NEWS_FEED_LIMIT = 5000;
const MAX_PER_SOURCE_LIMIT = 12000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeFeedOptions(limitOrOptions) {
  if (typeof limitOrOptions === 'object' && limitOrOptions !== null) {
    const rawLimit = Number(limitOrOptions.limit) || 250;
    const rawOffset = Number(limitOrOptions.offset) || 0;
    const rawCutoffHours = Number(limitOrOptions.cutoffHours) || 24;
    const rawTypeFilter = String(limitOrOptions.typeFilter || 'all').trim().toLowerCase();
    return {
      limit: clamp(rawLimit, 1, MAX_NEWS_FEED_LIMIT),
      offset: Math.max(0, rawOffset),
      cutoffHours: clamp(rawCutoffHours, 6, 24 * 30),
      search: String(limitOrOptions.search || '').trim().toLowerCase(),
      symbol: String(limitOrOptions.symbol || '').trim().toUpperCase(),
      typeFilter: rawTypeFilter === 'market' || rawTypeFilter === 'stocks' ? rawTypeFilter : 'all',
    };
  }

  return {
    limit: clamp(Number(limitOrOptions) || 250, 1, MAX_NEWS_FEED_LIMIT),
    offset: 0,
    cutoffHours: 24,
    search: '',
    symbol: '',
    typeFilter: 'all',
  };
}

function matchesSearch(article, search) {
  if (!search) return true;

  const haystack = [
    article.title,
    article.headline,
    article.source,
    article.symbol,
    ...(Array.isArray(article.symbols) ? article.symbols : []),
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  return haystack.includes(search);
}

function matchesSymbol(article, symbol) {
  if (!symbol) return true;
  const symbols = Array.isArray(article.symbols)
    ? article.symbols.map((entry) => String(entry || '').trim().toUpperCase()).filter(Boolean)
    : [];
  return symbols.includes(symbol) || String(article.symbol || '').trim().toUpperCase() === symbol;
}

function matchesType(article, typeFilter) {
  if (typeFilter === 'market') return article.type === 'macro';
  if (typeFilter === 'stocks') return article.type !== 'macro';
  return true;
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeTitle(title) {
  return normalizeTitle(title)
    .split(' ')
    .filter((token) => token.length > 1 && !TITLE_STOPWORDS.has(token));
}

function titleSimilarity(left, right) {
  const leftNormalized = normalizeTitle(left);
  const rightNormalized = normalizeTitle(right);

  if (!leftNormalized || !rightNormalized) {
    return 0;
  }

  if (leftNormalized === rightNormalized) {
    return 1;
  }

  const leftTokens = tokenizeTitle(left);
  const rightTokens = tokenizeTitle(right);
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (leftTokens.length + rightTokens.length);
}

function unionStrings(...values) {
  return Array.from(new Set(values.flat().filter(Boolean)));
}

function classifyArticle(symbols, title) {
  const normalizedSymbols = Array.isArray(symbols)
    ? symbols.map((entry) => String(entry || '').trim().toUpperCase()).filter(Boolean)
    : [];

  if (normalizedSymbols.length === 0) {
    return 'macro';
  }

  if (normalizedSymbols.some((symbol) => MARKET_SYMBOLS.has(symbol))) {
    return 'macro';
  }

  if (normalizedSymbols.length >= 5) {
    return 'macro';
  }

  if (MACRO_RE.test(title)) {
    return 'macro';
  }

  if (EARNINGS_RE.test(title)) {
    return 'earnings';
  }

  return 'stock';
}

function normalizeSourceRows(rows, sourceTable) {
  return (rows || []).map((row, index) => {
    const symbolsFromRow = Array.isArray(row.symbols)
      ? row.symbols.map((entry) => String(entry || '').trim().toUpperCase()).filter(Boolean)
      : [];
    const symbol = symbolsFromRow[0] || (typeof row.symbol === 'string' && row.symbol.trim() ? row.symbol.trim().toUpperCase() : null);
    const symbols = symbolsFromRow.length > 0 ? symbolsFromRow : (symbol ? [symbol] : []);
    const title = typeof row.title === 'string' && row.title.trim()
      ? row.title.trim()
      : typeof row.headline === 'string'
        ? row.headline.trim()
        : '';

    return {
      id: row.id != null ? String(row.id) : `${sourceTable}-${symbol || 'macro'}-${row.published_at || 'unknown'}-${index}`,
      source_id: row.id != null ? String(row.id) : null,
      source_table: sourceTable,
      title,
      headline: title,
      source: row.source || sourceTable,
      url: row.url || null,
      published_at: row.published_at || null,
      symbols,
      symbol,
      type: 'unknown',
    };
  }).filter((row) => row.title);
}

function buildArticleIdentity(row) {
  const normalizedTitle = normalizeTitle(row.title);
  const normalizedSource = String(row.source || '').trim().toLowerCase();
  const publishedBucket = row.published_at
    ? new Date(row.published_at).toISOString().slice(0, 16)
    : 'unknown';
  const normalizedUrl = String(row.url || '').trim();

  if (normalizedUrl) {
    return `url:${normalizedUrl}`;
  }

  if (normalizedTitle) {
    return `title:${normalizedSource}:${normalizedTitle}:${publishedBucket}`;
  }

  return `fallback:${row.source_table}:${row.id}`;
}

function mergeRowsByIdentity(rows, buildIdentity) {
  const deduped = new Map();

  for (const row of rows) {
    const identity = buildIdentity(row);
    const match = deduped.get(identity);
    if (!match) {
      deduped.set(identity, {
        ...row,
        related_articles: [
          {
            title: row.title,
            source: row.source,
            published_at: row.published_at,
            source_table: row.source_table,
            symbols: row.symbols,
            url: row.url,
          },
        ],
        sources: [row.source],
        source_tables: [row.source_table],
      });
      continue;
    }

    const existingTime = match.published_at ? Date.parse(match.published_at) : 0;
    const rowTime = row.published_at ? Date.parse(row.published_at) : 0;
    if (rowTime > existingTime) {
      match.title = row.title;
      match.headline = row.headline;
      match.published_at = row.published_at;
      match.source = row.source;
      match.url = row.url;
      match.id = row.id;
      match.source_id = row.source_id;
      match.source_table = row.source_table;
    }

    match.symbols = unionStrings(match.symbols, row.symbols);
    match.symbol = match.symbols[0] || null;
    match.sources = unionStrings(match.sources, [row.source]);
    match.source_tables = unionStrings(match.source_tables, [row.source_table]);
    match.related_articles.push({
      title: row.title,
      source: row.source,
      published_at: row.published_at,
      source_table: row.source_table,
      symbols: row.symbols,
      url: row.url,
    });
  }

  return Array.from(deduped.values());
}

function deduplicateArticles(rows) {
  const mergedRows = mergeRowsByIdentity(rows, buildArticleIdentity);

  return mergedRows.map((row) => {
    const type = classifyArticle(row.symbols, row.title);
    const primarySymbol = type === 'macro' ? null : (row.symbols.length === 1 ? row.symbols[0] : null);

    return {
      ...row,
      symbol: primarySymbol,
      type,
    };
  });
}

function deduplicateStockRows(rows) {
  const mergedRows = mergeRowsByIdentity(rows, (row) => `stock:${String(row.symbol || '').trim().toUpperCase()}:${buildArticleIdentity(row)}`);

  return mergedRows.map((row) => {
    const primarySymbol = row.symbols.length === 1 ? row.symbols[0] : (row.symbol || null);

    return {
      ...row,
      symbol: primarySymbol,
      symbols: primarySymbol ? [primarySymbol] : row.symbols,
      type: EARNINGS_RE.test(row.title) ? 'earnings' : 'stock',
    };
  });
}

function titleCase(label) {
  return String(label || '')
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function pickThemeTokens(article) {
  const tokens = tokenizeTitle(article.title).filter((token) => !GENERIC_THEME_TOKENS.has(token));
  if (tokens.length >= 2) {
    return tokens.slice(0, 2);
  }

  if (tokens.length === 1) {
    return tokens;
  }

  if (article.type === 'earnings') {
    return ['earnings'];
  }

  if (article.type === 'macro') {
    return ['macro'];
  }

  return ['market'];
}

function themeSimilarity(leftTokens, rightTokens) {
  const rightSet = new Set(rightTokens);
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftTokens.length, rightTokens.length, 1);
}

function buildThemes(articles, maxThemes = 10) {
  const groups = [];

  for (const article of articles) {
    const tokens = pickThemeTokens(article);
    const existing = groups.find((group) => themeSimilarity(group.tokens, tokens) >= 0.5);
    if (!existing) {
      groups.push({
        tokens,
        articles: [article],
        symbols: [...article.symbols],
      });
      continue;
    }

    existing.articles.push(article);
    existing.symbols = unionStrings(existing.symbols, article.symbols);
  }

  return groups
    .map((group) => ({
      theme: titleCase(group.tokens.join(' ')),
      symbols: group.symbols.slice(0, 10),
      articles: group.articles
        .sort((left, right) => {
          const leftTime = left.published_at ? Date.parse(left.published_at) : 0;
          const rightTime = right.published_at ? Date.parse(right.published_at) : 0;
          return rightTime - leftTime;
        })
        .slice(0, 6)
        .map((article) => ({
          id: article.id,
          title: article.title,
          source: article.source,
          published_at: article.published_at,
          symbols: article.symbols,
          type: article.type,
        })),
    }))
    .sort((left, right) => right.articles.length - left.articles.length)
    .slice(0, maxThemes);
}

async function getNewsFeed(limitOrOptions = 250) {
  const startedAt = Date.now();
  const {
    limit: safeLimit,
    offset,
    cutoffHours,
    search,
    symbol,
    typeFilter,
  } = normalizeFeedOptions(limitOrOptions);
  const perSourceLimit = clamp(Math.max(50, safeLimit * 4), 50, 500);
  const cutoff = new Date(Date.now() - (cutoffHours * 60 * 60 * 1000)).toISOString();
  const latestAllowed = new Date(Date.now() + (60 * 60 * 1000)).toISOString();

  async function loadSource(table, sql, params, timeoutMs) {
    try {
      const value = await queryWithTimeout(sql, params, {
        timeoutMs,
        label: `v2.news.${table}`,
        maxRetries: 0,
      });
      return { table, result: { status: 'fulfilled', value } };
    } catch (error) {
      return { table, result: { status: 'rejected', reason: error } };
    }
  }

  const sourceResults = [];
  sourceResults.push(await loadSource(
    'news_articles',
    `SELECT id, symbol, headline AS title, source, url, published_at
     FROM news_articles
     WHERE published_at >= $1
       AND published_at <= $2
       AND headline IS NOT NULL
     ORDER BY published_at DESC
     LIMIT $3`,
    [cutoff, latestAllowed, perSourceLimit],
    4000,
  ));

  const primaryRows = sourceResults[0].result.status === 'fulfilled'
    ? (sourceResults[0].result.value.rows || [])
    : [];
  const shouldLoadSecondarySources = primaryRows.length < Math.max(safeLimit, 25) || Boolean(symbol) || Boolean(search) || typeFilter !== 'all';

  if (shouldLoadSecondarySources) {
    sourceResults.push(await loadSource(
      'news_events',
      `SELECT id, symbol, headline AS title, source, url, published_at
       FROM news_events
       WHERE published_at >= $1
         AND published_at <= $2
         AND headline IS NOT NULL
       ORDER BY published_at DESC
       LIMIT $3`,
      [cutoff, latestAllowed, perSourceLimit],
      2000,
    ));
    sourceResults.push(await loadSource(
      'intel_news',
      `SELECT id, symbol, headline AS title, source, url, published_at
       FROM intel_news
       WHERE published_at >= $1
         AND published_at <= $2
         AND headline IS NOT NULL
         AND COALESCE(source, '') <> 'earnings_events'
       ORDER BY published_at DESC
       LIMIT $3`,
      [cutoff, latestAllowed, perSourceLimit],
      2000,
    ));
  } else {
    sourceResults.push({ table: 'news_events', result: { status: 'fulfilled', value: { rows: [] } } });
    sourceResults.push({ table: 'intel_news', result: { status: 'fulfilled', value: { rows: [] } } });
  }

  for (const sourceResult of sourceResults) {
    if (sourceResult.result.status === 'rejected') {
      console.warn('[V2_NEWS] source query failed', {
        source: sourceResult.table,
        error: sourceResult.result.reason?.message || String(sourceResult.result.reason),
      });
    }
  }

  const mergedRows = [
    ...normalizeSourceRows(sourceResults[0].result.status === 'fulfilled' ? sourceResults[0].result.value.rows || [] : [], 'news_articles'),
    ...normalizeSourceRows(sourceResults[1].result.status === 'fulfilled' ? sourceResults[1].result.value.rows || [] : [], 'news_events'),
    ...normalizeSourceRows(sourceResults[2].result.status === 'fulfilled' ? sourceResults[2].result.value.rows || [] : [], 'intel_news'),
  ];

  mergedRows.sort((left, right) => {
    const leftTime = left.published_at ? Date.parse(left.published_at) : 0;
    const rightTime = right.published_at ? Date.parse(right.published_at) : 0;
    return rightTime - leftTime;
  });

  const marketRows = [];
  const stockRows = [];

  for (const row of mergedRows) {
    if (classifyArticle(row.symbols, row.title) === 'macro') {
      marketRows.push(row);
    } else {
      stockRows.push(row);
    }
  }

  const deduplicated = [
    ...deduplicateArticles(marketRows),
    ...deduplicateStockRows(stockRows),
  ]
    .sort((left, right) => {
      const leftTime = left.published_at ? Date.parse(left.published_at) : 0;
      const rightTime = right.published_at ? Date.parse(right.published_at) : 0;
      return rightTime - leftTime;
    });

  const preTypeFiltered = deduplicated.filter((article) => matchesSearch(article, search) && matchesSymbol(article, symbol));
  const counts = {
    all: preTypeFiltered.length,
    market: preTypeFiltered.filter((article) => article.type === 'macro').length,
    stocks: preTypeFiltered.filter((article) => article.type !== 'macro').length,
  };

  const filteredArticles = preTypeFiltered.filter((article) => matchesType(article, typeFilter));

  const pagedArticles = filteredArticles
    .slice(offset, offset + safeLimit)
    .map((article) => ({
      id: article.id,
      source_id: article.source_id,
      title: article.title,
      headline: article.headline,
      source: article.source,
      url: article.url,
      published_at: article.published_at,
      symbols: article.symbols,
      symbol: article.symbol,
      type: article.type,
      sources: article.sources,
      source_tables: article.source_tables,
      related_count: article.related_articles.length,
    }));

  const themes = buildThemes(deduplicated, 10);
  const durationMs = Date.now() - startedAt;

  console.log('[V2_NEWS] intelligence feed complete', {
    durationMs,
    cutoffHours,
    mergedRows: mergedRows.length,
    marketRows: marketRows.length,
    stockRows: stockRows.length,
    rawArticles: deduplicated.length,
    filteredArticles: filteredArticles.length,
    returnedArticles: pagedArticles.length,
    offset,
    typeFilter,
    search: search ? '[set]' : '',
    symbol,
    themes: themes.length,
    sources: {
      news_articles: sourceResults[0].result.status === 'fulfilled' ? (sourceResults[0].result.value.rows || []).length : 0,
      news_events: sourceResults[1].result.status === 'fulfilled' ? (sourceResults[1].result.value.rows || []).length : 0,
      intel_news: sourceResults[2].result.status === 'fulfilled' ? (sourceResults[2].result.value.rows || []).length : 0,
    },
  });

  return {
    raw_articles: pagedArticles,
    themes,
    total_count: filteredArticles.length,
    counts,
    limit: safeLimit,
    offset,
    degraded: sourceResults
      .filter((sourceResult) => sourceResult.result.status === 'rejected')
      .map((sourceResult) => sourceResult.table),
  };
}

module.exports = {
  getNewsFeed,
};