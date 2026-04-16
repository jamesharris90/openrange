const express = require('express');
const { getCache, setCache } = require('../cache/memoryCache');
const { getNewsFeed } = require('../services/newsService');
const { queryWithTimeout } = require('../../db/pg');
const { normalizeSymbol } = require('../../services/researchCacheService');

const router = express.Router();

function parseWindowToHours(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === '24h' || normalized === 'today') return 24;
  if (normalized === '7d') return 24 * 7;
  if (normalized === '30d') return 24 * 30;
  const hoursMatch = normalized.match(/^(\d+)h$/);
  if (hoursMatch) return Number(hoursMatch[1]);
  const daysMatch = normalized.match(/^(\d+)d$/);
  if (daysMatch) return Number(daysMatch[1]) * 24;
  return 24;
}

function normalizeNewsRow(row, scope) {
  const headline = String(row?.headline || '').trim();
  if (!headline) {
    return null;
  }

  const publishedAt = row?.published_at instanceof Date
    ? row.published_at.toISOString()
    : (row?.published_at ? new Date(String(row.published_at)).toISOString() : null);

  return {
    id: row?.id || `${scope}-${headline}`,
    symbol: String(row?.symbol || '').trim().toUpperCase() || null,
    symbols: Array.isArray(row?.symbols)
      ? row.symbols.map((entry) => String(entry || '').trim().toUpperCase()).filter(Boolean)
      : [],
    headline,
    source: String(row?.source || 'News').trim() || 'News',
    url: String(row?.url || '').trim() || null,
    published_at: publishedAt,
    publishedAt: publishedAt,
    summary: String(row?.summary || '').trim() || null,
    context_scope: scope,
  };
}

function dedupeRows(rows) {
  const seen = new Set();
  const output = [];

  for (const row of rows) {
    if (!row) {
      continue;
    }

    const key = `${String(row.url || '').trim()}|${String(row.headline || '').trim().toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(row);
  }

  return output;
}

async function fetchDirectNews(symbolInput, limit, cutoffIso) {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) {
    return [];
  }

  const result = await queryWithTimeout(
    `SELECT
       id,
       UPPER(COALESCE(symbol, '')) AS symbol,
       COALESCE(symbols, ARRAY[]::text[]) AS symbols,
       COALESCE(headline, title) AS headline,
       COALESCE(summary, '') AS summary,
       COALESCE(source, publisher, 'News') AS source,
       url,
       published_at
     FROM news_articles
     WHERE (
       UPPER(COALESCE(symbol, '')) = $1
       OR (
         COALESCE(symbol, '') = ''
         AND EXISTS (
           SELECT 1
           FROM unnest(COALESCE(symbols, ARRAY[]::text[])) AS symbol_ref(symbol)
           WHERE UPPER(symbol_ref.symbol) = $1
         )
       )
     )
       AND published_at >= $2
     ORDER BY published_at DESC
     LIMIT $3`,
    [symbol, cutoffIso, limit],
    { timeoutMs: 3000, label: 'news.direct_only', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return dedupeRows((result.rows || []).map((row) => normalizeNewsRow(row, 'DIRECT')).filter(Boolean));
}

async function buildContextNewsPayload(symbolInput, limitInput) {
  const symbol = normalizeSymbol(symbolInput);
  const limit = Math.max(1, Math.min(Number(limitInput) || 5, 12));
  const cutoffIso = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const cacheKey = `news-v2-direct:v2:${symbol}:${limit}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return cached;
  }

  const directRows = await fetchDirectNews(symbol, limit, cutoffIso);
  const feedFallback = directRows.length >= limit
    ? []
    : ((await getNewsFeed({
        limit: Math.max(limit * 4, 20),
        offset: 0,
        cutoffHours: 20 * 24,
        symbol,
        typeFilter: 'stocks',
      }).catch(() => ({ raw_articles: [] }))).raw_articles || [])
        .map((row) => ({
          id: row?.id || row?.source_id || `${symbol}-${row?.headline || row?.title || row?.url || 'news'}`,
          symbol: String(row?.symbol || '').trim().toUpperCase() || symbol,
          symbols: Array.isArray(row?.symbols)
            ? row.symbols.map((entry) => String(entry || '').trim().toUpperCase()).filter(Boolean)
            : [symbol],
          headline: String(row?.headline || row?.title || '').trim(),
          source: String(row?.source || 'News').trim() || 'News',
          url: String(row?.url || '').trim() || null,
          published_at: row?.published_at || null,
          summary: null,
          context_scope: 'FEED',
        }))
        .filter((row) => row.headline);
  const mergedRows = dedupeRows([...directRows, ...feedFallback]).slice(0, limit);
  const directCount = directRows.length;
  const payload = {
    success: true,
    symbol,
    status: mergedRows.length > 0 ? 'ok' : 'no_data',
    count: mergedRows.length,
    direct_count: directCount,
    fallback_applied: mergedRows.length > directCount,
    context_source: directCount > 0 ? 'DIRECT' : mergedRows.length > 0 ? 'FEED' : 'NONE',
    data: mergedRows,
    coverage: {
      direct: directRows.length,
      total: mergedRows.length,
    },
    message: mergedRows.length === 0 ? 'No symbol-specific news available.' : null,
  };

  setCache(cacheKey, payload, 60000);
  return payload;
}

router.get('/', async (req, res) => {
  try {
    const directSymbol = String(req.query.symbol || req.query.symbols || '').trim();
    if (directSymbol) {
      const payload = await buildContextNewsPayload(directSymbol, req.query.limit);
      return res.json(payload);
    }

    const limit = Math.max(1, Math.min(Number(req.query.limit) || 500, 5000));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = Math.max(0, Number(req.query.offset) || ((page - 1) * limit));
    const cutoffHours = parseWindowToHours(req.query.window || req.query.time);
    const filterSymbol = String(req.query.filterSymbol || req.query.filter_symbol || '').trim().toUpperCase();
    const search = String(req.query.search || req.query.q || '').trim().toLowerCase();
    const type = String(req.query.type || 'all').trim().toLowerCase();
    const cacheKey = `news-v2-intelligence:v3:${limit}:${offset}:${cutoffHours}:${type}:${filterSymbol}:${search}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const feed = await getNewsFeed({
      limit,
      offset,
      cutoffHours,
      search,
      symbol: filterSymbol,
      typeFilter: type,
    });
    const payload = {
      success: true,
      count: Array.isArray(feed.raw_articles) ? feed.raw_articles.length : 0,
      total_count: Number(feed.total_count) || 0,
      counts: feed.counts || { all: 0, market: 0, stocks: 0 },
      limit,
      offset,
      page,
      type,
      filterSymbol,
      search,
      window: req.query.window || req.query.time || '24h',
      data: Array.isArray(feed.raw_articles) ? feed.raw_articles : [],
      raw_articles: Array.isArray(feed.raw_articles) ? feed.raw_articles : [],
      themes: Array.isArray(feed.themes) ? feed.themes : [],
    };

    setCache(cacheKey, payload, 60000);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      data: [],
    });
  }
});

module.exports = router;