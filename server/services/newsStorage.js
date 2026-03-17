const crypto = require('crypto');
const { pool } = require('../db/pg');

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (value.includes('finnhub')) return 'finnhub';
  if (value.includes('yahoo')) return 'yahoo';
  return 'fmp';
}

function normalizeSentiment(value) {
  const sentiment = String(value || '').trim().toLowerCase();
  if (sentiment === 'positive' || sentiment === 'bullish') return 'positive';
  if (sentiment === 'negative' || sentiment === 'bearish') return 'negative';
  return 'neutral';
}

async function ensureNewsStorageSchema() {
  await pool.query('ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS provider TEXT');
  await pool.query('ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS sentiment TEXT');
  await pool.query("UPDATE news_articles SET provider = COALESCE(provider, 'fmp') WHERE provider IS NULL");
  await pool.query("UPDATE news_articles SET sentiment = COALESCE(sentiment, 'neutral') WHERE sentiment IS NULL");

  await pool.query('CREATE INDEX IF NOT EXISTS idx_news_articles_provider ON news_articles(provider)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_news_articles_symbol ON news_articles(symbol)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_news_articles_published_at ON news_articles(published_at DESC)');
}

async function isDuplicateNewsArticle({ symbol, headline, publishedAt }) {
  if (!headline || !publishedAt) return false;

  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM news_articles
       WHERE COALESCE(symbol, '') = COALESCE($1, '')
         AND LOWER(COALESCE(headline, '')) = LOWER($2)
         AND date_trunc('minute', published_at) = date_trunc('minute', $3::timestamp)
     ) AS exists`,
    [symbol || null, headline, publishedAt]
  );

  return Boolean(rows[0]?.exists);
}

async function insertNormalizedNewsArticle(article) {
  const symbol = String(article.symbol || '').trim().toUpperCase() || null;
  const headline = String(article.headline || '').trim();
  const publishedAt = article.published_at || article.publishedAt || null;
  if (!headline || !publishedAt) return { inserted: false, reason: 'missing_required_fields' };

  const isDuplicate = await isDuplicateNewsArticle({ symbol, headline, publishedAt });
  if (isDuplicate) return { inserted: false, reason: 'duplicate' };

  const source = String(article.source || article.provider || 'news').trim() || 'news';
  const provider = normalizeProvider(article.provider || source);
  const url = String(article.url || '').trim() || null;
  const sentiment = normalizeSentiment(article.sentiment);
  const summary = String(article.summary || '').slice(0, 2000) || null;
  const catalystType = article.catalyst_type || null;
  const payload = article.raw_payload || {};

  const result = await pool.query(
    `INSERT INTO news_articles (
       id,
       symbol,
       headline,
       symbols,
       source,
       provider,
       url,
       published_at,
       sentiment,
       summary,
       catalyst_type,
       news_score,
       score_breakdown,
       raw_payload,
       created_at
     ) VALUES (
       $1::uuid,
       $2,
       $3,
       $4::text[],
       $5,
       $6,
       $7,
       $8::timestamp,
       $9,
       $10,
       $11,
       $12,
       $13::jsonb,
       $14::jsonb,
       NOW()
     )
     ON CONFLICT DO NOTHING`,
    [
      crypto.randomUUID(),
      symbol,
      headline,
      symbol ? [symbol] : [],
      source,
      provider,
      url,
      publishedAt,
      sentiment,
      summary,
      catalystType,
      Number.isFinite(Number(article.news_score)) ? Number(article.news_score) : 0,
      JSON.stringify(article.score_breakdown || {}),
      JSON.stringify(payload),
    ]
  );

  return {
    inserted: (result.rowCount || 0) > 0,
    reason: (result.rowCount || 0) > 0 ? 'inserted' : 'conflict',
  };
}

module.exports = {
  ensureNewsStorageSchema,
  insertNormalizedNewsArticle,
  normalizeProvider,
};
