const { queryWithTimeout } = require('../db/pg');

function normalizeMarketNewsRow(row, index = 0) {
  const symbol = String(row?.symbol || '').trim().toUpperCase() || null;
  const headline = String(row?.headline || row?.subject || '').trim();
  const source = String(row?.source || row?.source_tag || 'market-news').trim() || 'market-news';
  const url = row?.url || `internal://market-news/${symbol || 'MARKET'}/${Date.now()}-${index}`;
  const publishedAt = row?.published_at || row?.received_at || null;
  const summary = String(row?.summary || row?.raw_text || '').trim();

  return {
    symbol,
    headline,
    source,
    url,
    published_at: publishedAt,
    summary,
  };
}

async function fetchMarketNewsFallback(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
  try {
    const { rows } = await queryWithTimeout(
      `WITH catalyst_rows AS (
         SELECT
           symbol,
           headline,
           source,
           NULL::text AS summary,
           published_at,
           NULL::text AS url
         FROM trade_catalysts
         WHERE COALESCE(headline, '') <> ''
         ORDER BY published_at DESC NULLS LAST
         LIMIT $1
       ),
       article_rows AS (
         SELECT
           symbol,
           headline,
           source,
           NULL::text AS summary,
           published_at,
           url
         FROM news_articles
         WHERE COALESCE(headline, '') <> ''
         ORDER BY published_at DESC NULLS LAST
         LIMIT $1
       ),
       email_rows AS (
         SELECT
           NULL::text AS symbol,
           subject AS headline,
           source_tag AS source,
           LEFT(raw_text, 280) AS summary,
           received_at AS published_at,
           NULL::text AS url
         FROM intelligence_emails
         WHERE COALESCE(subject, '') <> ''
         ORDER BY received_at DESC NULLS LAST
         LIMIT $1
       )
       SELECT * FROM catalyst_rows
      UNION ALL
      SELECT * FROM article_rows
       UNION ALL
       SELECT * FROM email_rows
       ORDER BY published_at DESC NULLS LAST
       LIMIT $1`,
      [safeLimit],
      { label: 'services.market_news_fallback.fetch', timeoutMs: 6000, maxRetries: 1, retryDelayMs: 120 }
    );

    return rows.map((row, index) => normalizeMarketNewsRow(row, index)).filter((row) => row.headline);
  } catch (_error) {
    const { rows } = await queryWithTimeout(
      `SELECT symbol, headline, source, published_at, url
       FROM intel_news
       ORDER BY published_at DESC NULLS LAST
       LIMIT $1`,
      [safeLimit],
      { label: 'services.market_news_fallback.fallback_intel_news', timeoutMs: 4000, maxRetries: 1, retryDelayMs: 120 }
    );

    return rows.map((row, index) => normalizeMarketNewsRow(row, index)).filter((row) => row.headline);
  }
}

module.exports = {
  fetchMarketNewsFallback,
};
