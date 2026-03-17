/* eslint-disable no-console */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const BENZINGA_BASE_URL = 'https://api.benzinga.com/api/v2/news';

function parseArgs() {
  const tickers = process.argv[2] || 'AAPL,TSLA';
  const pageSizeRaw = Number(process.argv[3] || 10);
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.max(1, Math.min(100, Math.floor(pageSizeRaw))) : 10;
  return { tickers, pageSize };
}

function normalizeArticles(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.news)) return payload.news;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function fetchBenzingaNews({ tickers = 'AAPL,TSLA', pageSize = 10 } = {}) {
  const apiKey = process.env.BENZINGA_API_KEY;
  if (!apiKey) {
    throw new Error('BENZINGA_API_KEY missing from environment');
  }

  const params = new URLSearchParams();
  if (tickers) params.set('tickers', tickers);
  params.set('pageSize', String(pageSize));

  const baseUrl = `${BENZINGA_BASE_URL}?${params.toString()}`;

  let response;
  let payload;
  let authMode = 'header_token';
  try {
    response = await fetch(baseUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `token ${apiKey}`,
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new Error(`Network error while calling Benzinga: ${error.message}`);
  }

  const firstText = await response.text();
  try {
    payload = JSON.parse(firstText);
  } catch {
    payload = firstText;
  }

  // Fallback: some Benzinga accounts accept token as query param but reject header token auth.
  if (response.status === 401) {
    authMode = 'query_token';
    const fallbackUrl = `${baseUrl}&token=${encodeURIComponent(apiKey)}`;
    response = await fetch(fallbackUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });

    const fallbackText = await response.text();
    try {
      payload = JSON.parse(fallbackText);
    } catch {
      payload = fallbackText;
    }
  }

  if (!response.ok) {
    const providerMessage = payload && typeof payload === 'object'
      ? (payload.error || payload.message || payload.detail || null)
      : null;
    throw new Error(`Benzinga request failed: HTTP ${response.status}${providerMessage ? ` - ${providerMessage}` : ''}`);
  }

  const articles = normalizeArticles(payload);
  return {
    tickers,
    pageSize,
    authMode,
    count: articles.length,
    articles,
  };
}

module.exports = {
  BENZINGA_BASE_URL,
  fetchBenzingaNews,
};

if (require.main === module) {
  const { tickers, pageSize } = parseArgs();
  fetchBenzingaNews({ tickers, pageSize })
    .then((result) => {
      console.log(`[BENZINGA] tickers=${result.tickers} pageSize=${result.pageSize} authMode=${result.authMode} count=${result.count}`);
      for (const article of result.articles) {
        const title = article?.title || article?.headline || 'Untitled';
        const teaser = article?.teaser || article?.summary || article?.text || '';
        const published = article?.created || article?.updated || article?.published || article?.published_at || article?.date || null;
        const url = article?.url || article?.link || article?.article_url || null;
        console.log(`- title: ${title}`);
        console.log(`  teaser: ${String(teaser).slice(0, 220)}`);
        console.log(`  published: ${published}`);
        console.log(`  url: ${url}`);
      }
    })
    .catch((error) => {
      console.error(`[BENZINGA] ${error.message}`);
      process.exit(1);
    });
}
