const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { runIntelNewsEngine } = require('../engines/intelNewsEngine');
const { fetchMarketNewsFallback } = require('./marketNewsFallback');

function inferSentiment(headline = '') {
  const h = String(headline).toLowerCase();
  if (/beat|surge|rally|upgrade|growth|record|breakout/.test(h)) return 'positive';
  if (/miss|drop|plunge|downgrade|warning|lawsuit|offering/.test(h)) return 'negative';
  return 'neutral';
}

async function ensureIntelNewsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS intel_news (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT,
      headline TEXT,
      source TEXT,
      url TEXT UNIQUE,
      published_at TIMESTAMPTZ,
      sentiment TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 5000, label: 'services.intel_news_runner.ensure_table', maxRetries: 0 }
  );
}

async function upsertIntelNewsRow(row) {
  await queryWithTimeout(
    `INSERT INTO intel_news (
      symbol,
      headline,
      source,
      url,
      published_at,
      sentiment,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, now())
    ON CONFLICT (url)
    DO UPDATE SET
      symbol = EXCLUDED.symbol,
      headline = EXCLUDED.headline,
      source = EXCLUDED.source,
      published_at = EXCLUDED.published_at,
      sentiment = EXCLUDED.sentiment,
      updated_at = now()`,
    [
      row.symbol,
      row.headline,
      row.source,
      row.url,
      row.published_at,
      row.sentiment,
    ],
    { timeoutMs: 5000, label: 'services.intel_news_runner.upsert', maxRetries: 0 }
  );
}

async function runIntelNewsWithFallback() {
  const startedAt = Date.now();
  const apiKey = process.env.FMP_API_KEY;

  if (apiKey && apiKey !== 'REQUIRED') {
    try {
      const result = await runIntelNewsEngine();
      return {
        source: 'fmp',
        ...result,
        runtimeMs: Date.now() - startedAt,
      };
    } catch (error) {
      logger.warn('Intel news engine failed; switching to market-news fallback', {
        message: error?.message || 'Unknown error',
      });
    }
  }

  await ensureIntelNewsTable();
  const fallbackRows = await fetchMarketNewsFallback(100);

  let ingested = 0;
  for (const item of fallbackRows) {
    const headline = String(item?.headline || '').trim();
    const url = String(item?.url || '').trim();
    if (!headline || !url) continue;

    await upsertIntelNewsRow({
      symbol: item?.symbol || null,
      headline,
      source: item?.source || 'market-news',
      url,
      published_at: item?.published_at || null,
      sentiment: inferSentiment(headline),
    });
    ingested += 1;
  }

  logger.warn('Intel news fallback ingest complete', {
    ingested,
    runtimeMs: Date.now() - startedAt,
    reason: 'FMP_API_KEY missing',
  });

  return {
    source: 'market-news-fallback',
    ingested,
    skipped: false,
    runtimeMs: Date.now() - startedAt,
  };
}

module.exports = {
  runIntelNewsWithFallback,
};
