// @ts-nocheck
const axios = require('axios');
const { getCommonStocks } = require('./directoryServiceV1.ts');

const NEWS_URL = 'https://financialmodelingprep.com/stable/news/stock-latest';
const REQUEST_TIMEOUT_MS = 30_000;

const BUCKET_KEYWORDS = {
  earnings: ['earnings', 'eps', 'guidance', 'quarter', 'revenue', 'profit'],
  mna: ['acquisition', 'merger', 'takeover', 'buyout', 'deal'],
  fda: ['fda', 'clinical', 'phase', 'biotech', 'trial', 'drug'],
  analyst: ['analyst', 'upgrade', 'downgrade', 'price target', 'initiated', 'rating'],
  macro: ['fed', 'inflation', 'rates', 'yield', 'cpi', 'jobs report', 'treasury', 'macro'],
};

function toText(value) {
  return String(value || '').trim();
}

function toUpper(value) {
  return toText(value).toUpperCase();
}

function toLower(value) {
  return toText(value).toLowerCase();
}

function resolveBucket(item) {
  const hay = `${toLower(item?.title)} ${toLower(item?.text)} ${toLower(item?.summary)}`;

  if (BUCKET_KEYWORDS.earnings.some((k) => hay.includes(k))) return 'Earnings';
  if (BUCKET_KEYWORDS.mna.some((k) => hay.includes(k))) return 'M&A';
  if (BUCKET_KEYWORDS.fda.some((k) => hay.includes(k))) return 'FDA / biotech';
  if (BUCKET_KEYWORDS.analyst.some((k) => hay.includes(k))) return 'Analyst';
  if (BUCKET_KEYWORDS.macro.some((k) => hay.includes(k))) return 'Macro';
  return 'Other';
}

function parsePublishedMs(item) {
  const dateRaw = toText(item?.publishedDate || item?.date || item?.published_at);
  if (!dateRaw) return null;
  const ms = Date.parse(dateRaw);
  return Number.isFinite(ms) ? ms : null;
}

async function fetchNewsRows() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('FMP_API_KEY missing for news fetch');
  }

  const response = await axios.get(NEWS_URL, {
    params: {
      apikey: apiKey,
    },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`News fetch failed with status ${response.status}`);
  }

  return Array.isArray(response.data) ? response.data : [];
}

async function getNewsForUniverse(hoursBack = 24, options = {}) {
  const commonStocks = await getCommonStocks();
  const symbolToExchange = new Map(
    commonStocks.map((stock) => [toUpper(stock?.symbol), toUpper(stock?.exchange)])
  );

  const cutoffMs = Date.now() - Math.max(1, Number(hoursBack) || 24) * 60 * 60 * 1000;
  const wantedBucket = toLower(options.bucket || '');
  const wantedExchange = toUpper(options.exchange || '');

  const rows = await fetchNewsRows();
  const out = [];

  for (const row of rows) {
    const symbol = toUpper(row?.symbol);
    if (!symbol || !symbolToExchange.has(symbol)) continue;

    const publishedMs = parsePublishedMs(row);
    if (publishedMs == null || publishedMs < cutoffMs) continue;

    const bucket = resolveBucket(row);
    const exchange = symbolToExchange.get(symbol) || null;

    if (wantedBucket && toLower(bucket) !== wantedBucket) continue;
    if (wantedExchange && exchange !== wantedExchange) continue;

    out.push({
      symbol,
      exchange,
      bucket,
      headline: toText(row?.title),
      summary: toText(row?.text || row?.summary),
      source: toText(row?.site || row?.source || 'FMP'),
      url: toText(row?.url),
      publishedDate: toText(row?.publishedDate),
      publishedMs,
    });
  }

  console.log('News Engine Ready:', true);
  return out;
}

module.exports = {
  getNewsForUniverse,
};
