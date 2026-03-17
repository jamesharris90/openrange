/* eslint-disable no-console */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
const ALLOWED_SORTS = new Set(['LATEST', 'EARLIEST', 'RELEVANCE']);

function normalizeLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(Math.floor(parsed), 1000);
}

function normalizeSort(sort) {
  const value = String(sort || 'LATEST').toUpperCase();
  return ALLOWED_SORTS.has(value) ? value : 'LATEST';
}

function buildNewsSentimentParams(options = {}) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error('ALPHA_VANTAGE_API_KEY is missing from environment');
  }

  const params = new URLSearchParams({
    function: 'NEWS_SENTIMENT',
    apikey: apiKey,
    sort: normalizeSort(options.sort),
    limit: String(normalizeLimit(options.limit)),
  });

  if (options.tickers) params.set('tickers', String(options.tickers));
  if (options.topics) params.set('topics', String(options.topics));
  if (options.time_from) params.set('time_from', String(options.time_from));
  if (options.time_to) params.set('time_to', String(options.time_to));

  return params;
}

async function fetchAlphaVantageNews(options = {}) {
  const params = buildNewsSentimentParams(options);
  const url = `${ALPHA_VANTAGE_BASE_URL}?${params.toString()}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    const wrapped = new Error(`Network error while calling Alpha Vantage: ${error.message}`);
    wrapped.cause = error;
    throw wrapped;
  }

  if (!response.ok) {
    throw new Error(`Alpha Vantage request failed: HTTP ${response.status}`);
  }

  const payload = await response.json();

  if (payload?.Note || payload?.Information || payload?.['Error Message']) {
    const rateLimitLike = payload?.Note || payload?.Information || payload?.['Error Message'];
    throw new Error(`Alpha Vantage API error: ${rateLimitLike}`);
  }

  if (!Array.isArray(payload?.feed)) {
    throw new Error('Alpha Vantage response did not include a valid feed array');
  }

  return payload.feed;
}

module.exports = {
  ALPHA_VANTAGE_BASE_URL,
  buildNewsSentimentParams,
  fetchAlphaVantageNews,
};

if (require.main === module) {
  fetchAlphaVantageNews({
    tickers: process.env.ALPHA_VANTAGE_TICKERS || 'IBM',
    topics: process.env.ALPHA_VANTAGE_TOPICS || undefined,
    time_from: process.env.ALPHA_VANTAGE_TIME_FROM || undefined,
    time_to: process.env.ALPHA_VANTAGE_TIME_TO || undefined,
    sort: process.env.ALPHA_VANTAGE_SORT || 'LATEST',
    limit: process.env.ALPHA_VANTAGE_LIMIT || 50,
  })
    .then((feed) => {
      console.log(JSON.stringify({ ok: true, count: feed.length, feed }, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exit(1);
    });
}
