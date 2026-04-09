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
const MACRO_RE = /\b(fed|cpi|rates|treasury)\b/i;

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
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return 'macro';
  }

  if (EARNINGS_RE.test(title)) {
    return 'earnings';
  }

  if (MACRO_RE.test(title)) {
    return 'macro';
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
      published_at: row.published_at || null,
      symbols,
      symbol,
      type: 'unknown',
    };
  }).filter((row) => row.title);
}

function deduplicateArticles(rows) {
  const deduped = [];

  for (const row of rows) {
    const match = deduped.find((existing) => titleSimilarity(existing.title, row.title) > 0.8);
    if (!match) {
      deduped.push({
        ...row,
        related_articles: [
          {
            title: row.title,
            source: row.source,
            published_at: row.published_at,
            source_table: row.source_table,
            symbols: row.symbols,
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
    });
  }

  return deduped.map((row) => ({
    ...row,
    type: classifyArticle(row.symbols, row.title),
  }));
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

async function getNewsFeed(limit = 50) {
  const startedAt = Date.now();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 50));
  const perSourceLimit = Math.max(1000, safeLimit * 40);
  const cutoff = new Date(Date.now() - (72 * 60 * 60 * 1000)).toISOString();
  const latestAllowed = new Date(Date.now() + (60 * 60 * 1000)).toISOString();

  const [newsArticlesResult, newsEventsResult, intelNewsResult] = await Promise.allSettled([
    queryWithTimeout(
      `SELECT id, symbol, headline AS title, source, published_at
       FROM news_articles
       WHERE published_at >= $1
         AND published_at <= $2
         AND headline IS NOT NULL
       ORDER BY published_at DESC
       LIMIT $3`,
      [cutoff, latestAllowed, perSourceLimit],
      { timeoutMs: 8000, label: 'v2.news.news_articles', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT id, symbol, headline AS title, source, published_at
       FROM news_events
       WHERE published_at >= $1
         AND published_at <= $2
         AND headline IS NOT NULL
       ORDER BY published_at DESC
       LIMIT $3`,
      [cutoff, latestAllowed, perSourceLimit],
      { timeoutMs: 8000, label: 'v2.news.news_events', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT id, symbol, headline AS title, source, published_at
       FROM intel_news
       WHERE published_at >= $1
         AND published_at <= $2
         AND headline IS NOT NULL
         AND COALESCE(source, '') <> 'earnings_events'
       ORDER BY published_at DESC
       LIMIT $3`,
      [cutoff, latestAllowed, perSourceLimit],
      { timeoutMs: 8000, label: 'v2.news.intel_news', maxRetries: 0 }
    ),
  ]);

  const sourceResults = [
    { table: 'news_articles', result: newsArticlesResult },
    { table: 'news_events', result: newsEventsResult },
    { table: 'intel_news', result: intelNewsResult },
  ];

  for (const sourceResult of sourceResults) {
    if (sourceResult.result.status === 'rejected') {
      console.warn('[V2_NEWS] source query failed', {
        source: sourceResult.table,
        error: sourceResult.result.reason?.message || String(sourceResult.result.reason),
      });
    }
  }

  const mergedRows = [
    ...normalizeSourceRows(newsArticlesResult.status === 'fulfilled' ? newsArticlesResult.value.rows || [] : [], 'news_articles'),
    ...normalizeSourceRows(newsEventsResult.status === 'fulfilled' ? newsEventsResult.value.rows || [] : [], 'news_events'),
    ...normalizeSourceRows(intelNewsResult.status === 'fulfilled' ? intelNewsResult.value.rows || [] : [], 'intel_news'),
  ];

  if (mergedRows.length === 0) {
    throw new Error('Failed to load recent news rows');
  }

  mergedRows.sort((left, right) => {
    const leftTime = left.published_at ? Date.parse(left.published_at) : 0;
    const rightTime = right.published_at ? Date.parse(right.published_at) : 0;
    return rightTime - leftTime;
  });

  const deduplicated = deduplicateArticles(mergedRows)
    .sort((left, right) => {
      const leftTime = left.published_at ? Date.parse(left.published_at) : 0;
      const rightTime = right.published_at ? Date.parse(right.published_at) : 0;
      return rightTime - leftTime;
    })
    .slice(0, safeLimit)
    .map((article) => ({
      id: article.id,
      source_id: article.source_id,
      title: article.title,
      headline: article.headline,
      source: article.source,
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
    mergedRows: mergedRows.length,
    rawArticles: deduplicated.length,
    themes: themes.length,
    sources: {
      news_articles: newsArticlesResult.status === 'fulfilled' ? (newsArticlesResult.value.rows || []).length : 0,
      news_events: newsEventsResult.status === 'fulfilled' ? (newsEventsResult.value.rows || []).length : 0,
      intel_news: intelNewsResult.status === 'fulfilled' ? (intelNewsResult.value.rows || []).length : 0,
    },
  });

  return {
    raw_articles: deduplicated,
    themes,
  };
}

module.exports = {
  getNewsFeed,
};