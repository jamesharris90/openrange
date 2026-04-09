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

  return {
    id: row?.id || `${scope}-${headline}`,
    symbol: String(row?.symbol || '').trim().toUpperCase() || null,
    symbols: Array.isArray(row?.symbols)
      ? row.symbols.map((entry) => String(entry || '').trim().toUpperCase()).filter(Boolean)
      : [],
    headline,
    source: String(row?.source || 'News').trim() || 'News',
    url: String(row?.url || '').trim() || null,
    published_at: row?.published_at || null,
    publishedAt: row?.published_at || null,
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
     WHERE UPPER(COALESCE(symbol, '')) = $1
       AND published_at >= $2
     ORDER BY published_at DESC
     LIMIT $3`,
    [symbol, cutoffIso, limit],
    { timeoutMs: 1800, label: 'news.direct_only', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return dedupeRows((result.rows || []).map((row) => normalizeNewsRow(row, 'DIRECT')).filter(Boolean));
}

async function buildContextNewsPayload(symbolInput, limitInput) {
  const symbol = normalizeSymbol(symbolInput);
  const limit = Math.max(1, Math.min(Number(limitInput) || 5, 12));
  const cutoffIso = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const cacheKey = `news-v2-direct:v1:${symbol}:${limit}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return cached;
  }

  const directRows = await fetchDirectNews(symbol, limit, cutoffIso);
  const directCount = directRows.length;
  const payload = {
    success: true,
    symbol,
    status: directCount > 0 ? 'ok' : 'no_data',
    count: directRows.length,
    direct_count: directCount,
    fallback_applied: false,
    context_source: directCount > 0 ? 'DIRECT' : 'NONE',
    data: directRows,
    coverage: {
      direct: directRows.length,
      total: directRows.length,
    },
    message: directCount === 0 ? 'No symbol-specific news available.' : null,
  };

  setCache(cacheKey, payload, 60000);
  return payload;
}

router.get('/', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || req.query.symbols || '').trim();
    if (symbol) {
      const payload = await buildContextNewsPayload(symbol, req.query.limit);
      return res.json(payload);
    }

    const limit = Math.max(1, Math.min(Number(req.query.limit) || 500, 5000));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = Math.max(0, Number(req.query.offset) || ((page - 1) * limit));
    const cutoffHours = parseWindowToHours(req.query.window || req.query.time);
    const cacheKey = `news-v2-intelligence:v2:${limit}:${offset}:${cutoffHours}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const feed = await getNewsFeed({ limit, offset, cutoffHours });
    const payload = {
      success: true,
      count: Array.isArray(feed.raw_articles) ? feed.raw_articles.length : 0,
      total_count: Number(feed.total_count) || 0,
      limit,
      offset,
      page,
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