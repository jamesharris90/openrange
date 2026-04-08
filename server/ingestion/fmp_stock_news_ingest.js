/**
 * fmp_stock_news_ingest.js
 *
 * Fetches the latest stock-specific news from FMP and upserts into news_articles.
 * Uses endpoint: GET /stable/news/stock-latest?page=0&limit=50
 *
 * FMP response fields:
 *   symbol, publishedDate, publisher, title, image, site, text, url
 *
 * Maps to news_articles columns:
 *   id (sha256 of url), symbol, headline (title), summary (text),
 *   source (site), publisher, url, published_at, provider='fmp',
 *   catalyst_type='stock_news', sentiment='neutral', news_score=0
 */

const axios  = require('axios');
const crypto = require('crypto');
const { queryWithTimeout } = require('../db/pg');

const FMP_BASE  = 'https://financialmodelingprep.com';
const PAGES     = 3;    // fetch pages 0-2 → up to 150 articles per run
const PAGE_SIZE = 50;

function makeId(url) {
  // Produce a deterministic UUID v4-shaped ID from the URL
  const h = crypto.createHash('md5').update(url || Math.random().toString()).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

/**
 * Fetch one page of FMP stock news.
 */
async function fetchPage(page, apiKey) {
  const resp = await axios.get(`${FMP_BASE}/stable/news/stock-latest`, {
    params: { page, limit: PAGE_SIZE, apikey: apiKey },
    timeout: 15_000,
    validateStatus: () => true,
  });
  if (resp.status !== 200 || !Array.isArray(resp.data)) return [];
  return resp.data;
}

/**
 * Upsert a single article into news_articles.
 * Uses url as the dedup key (stored as `id` = sha256(url)).
 */
async function upsertArticle(article) {
  const id = makeId(article.url);
  const publishedAt = article.publishedDate
    ? new Date(article.publishedDate).toISOString()
    : null;

  const sym = article.symbol || null;
  const symbolsArr = sym ? `{${sym}}` : '{}';

  await queryWithTimeout(
    `INSERT INTO news_articles
       (id, symbol, symbols, headline, summary, source, publisher, url, published_at,
        provider, catalyst_type, sentiment, news_score, score_breakdown, raw_payload)
     VALUES ($1,$2,$3::text[],$4,$5,$6,$7,$8,$9,'fmp','stock_news','neutral',0,'{}'::jsonb,$10)
     ON CONFLICT (id) DO UPDATE SET
       symbol      = EXCLUDED.symbol,
       symbols     = EXCLUDED.symbols,
       headline    = EXCLUDED.headline,
       summary     = EXCLUDED.summary,
       source      = EXCLUDED.source,
       publisher   = EXCLUDED.publisher,
       published_at= EXCLUDED.published_at,
       raw_payload = EXCLUDED.raw_payload`,
    [
      id,
      sym,
      symbolsArr,
      article.title  || article.headline || '',
      article.text   || article.summary  || null,
      article.site   || null,
      article.publisher || null,
      article.url    || null,
      publishedAt,
      JSON.stringify(article),
    ],
    { label: 'fmpStockNews.upsert', timeoutMs: 3000, maxRetries: 0 }
  );
}

/**
 * Main ingestion function. Fetches PAGES pages and upserts into DB.
 * Returns { inserted, errors }.
 */
async function runStockNewsIngestion() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn('[fmpStockNews] FMP_API_KEY not set — skipping');
    return { inserted: 0, errors: 0 };
  }

  let inserted = 0, errors = 0;

  for (let page = 0; page < PAGES; page++) {
    let articles;
    try {
      articles = await fetchPage(page, apiKey);
    } catch (err) {
      console.error(`[fmpStockNews] fetch page ${page} failed:`, err.message);
      errors++;
      continue;
    }

    for (const article of articles) {
      if (!article.url && !article.title) continue;
      try {
        await upsertArticle(article);
        inserted++;
      } catch (err) {
        errors++;
      }
    }
  }

  console.log(`[fmpStockNews] ingested ${inserted} articles (${errors} errors)`);
  return { inserted, errors };
}

module.exports = { runStockNewsIngestion };
