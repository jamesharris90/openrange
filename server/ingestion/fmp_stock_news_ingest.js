const crypto = require('crypto');
const { queryWithTimeout } = require('../db/pg');
const { fmpFetch } = require('../services/fmpClient');
const { normalizeSymbol, mapFromProviderSymbol } = require('../utils/symbolMap');

const PAGES     = 3;
const PAGE_SIZE = 50;
const FEEDS = [
  { endpoint: '/news/stock-latest', catalystType: 'stock_news' },
  { endpoint: '/news/press-releases-latest', catalystType: 'press_release' },
  { endpoint: '/fmp-articles', catalystType: 'market_analysis' },
];

function makeId(seed) {
  const h = crypto.createHash('md5').update(seed || Math.random().toString()).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

function normalizeFeedSymbol(value) {
  if (!value) {
    return null;
  }

  const raw = String(value).trim().toUpperCase();
  const exchangeStripped = raw.includes(':') ? raw.split(':').pop() : raw;
  const canonical = mapFromProviderSymbol(normalizeSymbol(exchangeStripped));
  return canonical || null;
}

function extractSymbols(article) {
  const rawValues = [
    article.symbol,
    article.stockSymbol,
    article.ticker,
    article.tickers,
  ].filter((value) => value != null);

  const tokens = rawValues.flatMap((value) => {
    if (Array.isArray(value)) {
      return value;
    }

    return String(value)
      .split(/[\s,;|]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  });

  return Array.from(new Set(tokens.map(normalizeFeedSymbol).filter(Boolean)));
}

async function fetchPage(endpoint, page) {
  const payload = await fmpFetch(endpoint, { page, limit: PAGE_SIZE }).catch(() => null);
  return Array.isArray(payload) ? payload : [];
}

async function upsertArticle(article, feed) {
  const url = article.url || article.link || null;
  const title = article.title || article.headline || article.name || '';
  const summary = article.text || article.summary || article.content || article.snippet || null;
  const publishedAt = article.publishedDate || article.publishedAt || article.date
    ? new Date(article.publishedDate || article.publishedAt || article.date).toISOString()
    : null;
  const symbols = extractSymbols(article);
  const primarySymbol = symbols.length === 1 ? symbols[0] : normalizeFeedSymbol(article.symbol);
  const idSeed = url || [feed.endpoint, title, publishedAt, primarySymbol || symbols.join(',')].join('|');

  await queryWithTimeout(
    `INSERT INTO news_articles
       (id, symbol, symbols, headline, summary, source, publisher, url, published_at,
        provider, catalyst_type, sentiment, news_score, score_breakdown, raw_payload)
      VALUES ($1,$2,$3::text[],$4,$5,$6,$7,$8,$9,'fmp',$10,'neutral',0,'{}'::jsonb,$11)
     ON CONFLICT (id) DO UPDATE SET
       symbol      = EXCLUDED.symbol,
       symbols     = EXCLUDED.symbols,
       headline    = EXCLUDED.headline,
       summary     = EXCLUDED.summary,
       source      = EXCLUDED.source,
       publisher   = EXCLUDED.publisher,
       published_at= EXCLUDED.published_at,
       catalyst_type = EXCLUDED.catalyst_type,
       raw_payload = EXCLUDED.raw_payload`,
    [
      makeId(idSeed),
      primarySymbol,
      symbols,
      title,
      summary,
      article.site || article.source || null,
      article.publisher || article.source || null,
      url,
      publishedAt,
      feed.catalystType,
      JSON.stringify(article),
    ],
    { label: 'fmpStockNews.upsert', timeoutMs: 3000, maxRetries: 0 }
  );
}

async function runStockNewsIngestion() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn('[fmpStockNews] FMP_API_KEY not set — skipping');
    return { inserted: 0, errors: 0 };
  }

  let inserted = 0, errors = 0;

  for (const feed of FEEDS) {
    for (let page = 0; page < PAGES; page++) {
      let articles;
      try {
        articles = await fetchPage(feed.endpoint, page);
      } catch (err) {
        console.error(`[fmpStockNews] fetch ${feed.endpoint} page ${page} failed:`, err.message);
        errors++;
        continue;
      }

      for (const article of articles) {
        if (!article.url && !article.link && !article.title && !article.headline && !article.name) {
          continue;
        }
        try {
          await upsertArticle(article, feed);
          inserted++;
        } catch (err) {
          errors++;
        }
      }
    }
  }

  console.log(`[fmpStockNews] ingested ${inserted} articles (${errors} errors)`);
  return { inserted, errors };
}

module.exports = { runStockNewsIngestion };
