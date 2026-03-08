const crypto = require('crypto');
const Parser = require('rss-parser');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const DEFAULT_FEEDS = [
  'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC,^IXIC,^DJI&region=US&lang=en-US',
  'https://www.marketwatch.com/feeds/topstories',
  'https://www.investing.com/rss/news_301.rss',
  'https://www.cnbc.com/id/100003114/device/rss/rss.html',
];

function getFeedUrls() {
  const configured = String(process.env.RSS_FEED_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_FEEDS;
}

function hashIdFromUrl(url) {
  return `rss_${crypto.createHash('sha1').update(String(url)).digest('hex')}`;
}

function normalizeSymbols(item = {}) {
  const categorySymbols = (item.categories || [])
    .map((value) => String(value || '').trim().toUpperCase())
    .filter((value) => /^[A-Z]{1,5}$/.test(value));

  if (categorySymbols.length) {
    return Array.from(new Set(categorySymbols));
  }

  const fromHeadline = String(item.title || '').match(/\$([A-Z]{1,5})/g) || [];
  return Array.from(new Set(fromHeadline.map((token) => token.replace('$', ''))));
}

async function ensureNewsArticlesSchema() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS news_articles (
      id TEXT PRIMARY KEY,
      headline TEXT NOT NULL,
      symbols TEXT[] NOT NULL DEFAULT '{}',
      source TEXT,
      url TEXT,
      published_at TIMESTAMPTZ,
      summary TEXT,
      catalyst_type TEXT,
      news_score NUMERIC NOT NULL DEFAULT 0,
      score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      ai_analysis JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'workers.rss.ensure_news_articles', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS url TEXT',
    [],
    { timeoutMs: 5000, label: 'workers.rss.ensure_news_articles_url', maxRetries: 0 }
  );
}

async function upsertArticle(item, feedUrl) {
  const headline = String(item.title || item.contentSnippet || '').trim();
  const url = String(item.link || item.guid || '').trim();
  if (!headline || !url) return false;

  const source = String(item.creator || item.author || item.source || feedUrl).slice(0, 255);
  const publishedAt = item.isoDate || item.pubDate || null;
  const symbols = normalizeSymbols(item);
  const payload = item && typeof item === 'object' ? item : {};

  const updateResult = await queryWithTimeout(
    `UPDATE news_articles
     SET headline = $1,
         source = $2,
         published_at = COALESCE($3::timestamptz, published_at),
         summary = COALESCE($4, summary),
         symbols = CASE WHEN COALESCE(array_length($5::text[], 1), 0) = 0 THEN symbols ELSE $5::text[] END,
         raw_payload = $6::jsonb
     WHERE url = $7`,
    [
      headline,
      source,
      publishedAt,
      String(item.contentSnippet || item.content || '').slice(0, 2000) || null,
      symbols,
      JSON.stringify(payload),
      url,
    ],
    { timeoutMs: 7000, label: 'workers.rss.update_by_url', maxRetries: 0 }
  );

  if (updateResult.rowCount > 0) {
    return true;
  }

  await queryWithTimeout(
    `INSERT INTO news_articles (
      id,
      headline,
      symbols,
      source,
      url,
      published_at,
      summary,
      catalyst_type,
      news_score,
      score_breakdown,
      raw_payload
    ) VALUES (
      $1,
      $2,
      $3::text[],
      $4,
      $5,
      $6::timestamptz,
      $7,
      $8,
      $9,
      $10::jsonb,
      $11::jsonb
    )
    ON CONFLICT (id)
    DO UPDATE SET
      headline = EXCLUDED.headline,
      symbols = EXCLUDED.symbols,
      source = EXCLUDED.source,
      url = EXCLUDED.url,
      published_at = EXCLUDED.published_at,
      summary = EXCLUDED.summary,
      raw_payload = EXCLUDED.raw_payload`,
    [
      hashIdFromUrl(url),
      headline,
      symbols,
      source,
      url,
      publishedAt,
      String(item.contentSnippet || item.content || '').slice(0, 2000) || null,
      'rss',
      0,
      JSON.stringify({ provider: 'rss' }),
      JSON.stringify(payload),
    ],
    { timeoutMs: 7000, label: 'workers.rss.insert_article', maxRetries: 0 }
  );

  return true;
}

async function runRssWorker() {
  const startedAt = Date.now();
  const feedUrls = getFeedUrls();
  let ingested = 0;
  const failures = [];

  await ensureNewsArticlesSchema();
  const parser = new Parser({ timeout: 15000 });

  for (const feedUrl of feedUrls) {
    try {
      logger.info('[RSS] Fetching feed', { feedUrl });
      const feed = await parser.parseURL(feedUrl);
      const items = Array.isArray(feed?.items) ? feed.items : [];

      for (const item of items) {
        const upserted = await upsertArticle(item, feedUrl);
        if (upserted) ingested += 1;
      }

      logger.info('[RSS] Feed processed', { feedUrl, count: items.length });
    } catch (error) {
      failures.push({ feedUrl, error: error.message });
      logger.error('[RSS] Feed processing failed', { feedUrl, error: error.message });
    }
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('[RSS] Worker completed', {
    feeds: feedUrls.length,
    ingested,
    failures: failures.length,
    runtimeMs,
  });

  return {
    feeds: feedUrls.length,
    ingested,
    failures,
    runtimeMs,
  };
}

module.exports = {
  runRssWorker,
};
