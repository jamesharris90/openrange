const axios = require('axios');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function inferSentiment(headline = '') {
  const h = String(headline).toLowerCase();
  if (/beat|surge|rally|upgrade|growth|record/.test(h)) return 'positive';
  if (/miss|drop|plunge|downgrade|warning|lawsuit/.test(h)) return 'negative';
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
    { timeoutMs: 5000, label: 'engines.intelNews.ensure_table', maxRetries: 0 }
  );
}

async function runIntelNewsEngine() {
  const startedAt = Date.now();
  await ensureIntelNewsTable();

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || apiKey === 'REQUIRED') {
    logger.warn('Intel news engine skipped: FMP_API_KEY missing');
    return { ingested: 0, runtimeMs: Date.now() - startedAt, skipped: true };
  }

  const url = `https://financialmodelingprep.com/stable/news/stock?symbols=AAPL,MSFT,NVDA,SPY,QQQ&limit=100&apikey=${encodeURIComponent(apiKey)}`;
  const response = await axios.get(url, { timeout: 20000 });
  const rows = Array.isArray(response.data) ? response.data : [];

  for (const row of rows) {
    const symbol = String(row?.symbol || row?.ticker || '').trim().toUpperCase() || null;
    const headline = String(row?.title || row?.headline || '').trim();
    const articleUrl = row?.url || row?.link || null;
    if (!headline || !articleUrl) continue;

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
        symbol,
        headline,
        row?.site || row?.source || 'FMP',
        articleUrl,
        row?.publishedDate || row?.published_at || null,
        inferSentiment(headline),
      ],
      { timeoutMs: 5000, label: 'engines.intelNews.upsert', maxRetries: 0 }
    );
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('Intel news engine complete', { ingested: rows.length, runtimeMs });
  return { ingested: rows.length, runtimeMs };
}

module.exports = {
  runIntelNewsEngine,
};
