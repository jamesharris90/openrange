/* eslint-disable no-console */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const Parser = require('rss-parser');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { queryWithTimeout } = require('../db/pg');
const { ensureNewsStorageSchema, insertNormalizedNewsArticle } = require('../services/newsStorage');

const parser = new Parser({ timeout: 15000 });

const BASE_URL = process.env.AUDIT_BASE_URL || process.env.TEST_BASE_URL;
if (!BASE_URL) {
  throw new Error('Backend API base not configured');
}
const REPORT_PATH = path.resolve(__dirname, '../reports/catalyst_data_source_audit_report.json');
const STABILITY_RUNS = 5;
const SKIP_STOCKTWITS = String(process.env.AUDIT_SKIP_STOCKTWITS || '').toLowerCase() === 'true';
const INCLUDE_FMP_V3_NEWS = String(process.env.AUDIT_INCLUDE_FMP_V3_NEWS || '').toLowerCase() === 'true';
const SKIP_FMP = String(process.env.AUDIT_SKIP_FMP || '').toLowerCase() === 'true';

const RSS_DEFAULT_FEEDS = [
  'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC,^IXIC,^DJI&region=US&lang=en-US',
  'https://www.marketwatch.com/feeds/topstories',
  'https://www.investing.com/rss/news_301.rss',
  'https://www.cnbc.com/id/100003114/device/rss/rss.html',
];

function nowIso() {
  return new Date().toISOString();
}

function getRssFeedUrls() {
  const configured = String(process.env.RSS_FEED_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  return configured.length ? configured : RSS_DEFAULT_FEEDS;
}

function safeError(error) {
  return {
    message: String(error?.message || error || 'Unknown error'),
    code: error?.code || null,
  };
}

function hasFields(row, fields) {
  const missing = fields.filter((field) => row?.[field] === undefined || row?.[field] === null);
  return { ok: missing.length === 0, missing };
}

async function fetchJson(url, options = {}) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs || 15000),
  });
  const latencyMs = Date.now() - startedAt;
  let body = null;
  let rawText = null;

  try {
    body = await response.json();
  } catch {
    rawText = await response.text().catch(() => null);
  }

  return {
    ok: response.ok,
    status: response.status,
    latencyMs,
    body,
    rawText,
  };
}

async function checkFmp() {
  if (SKIP_FMP) {
    return {
      skipped: true,
      ready: true,
      reachable: true,
      reason: 'skipped_by_config',
      endpoints: [],
    };
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return {
      ready: false,
      reachable: false,
      error: 'FMP_API_KEY missing',
      endpoints: [],
    };
  }

  const endpoints = [
    {
      name: 'stable_quote',
      url: `https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=${apiKey}`,
      fields: ['symbol', 'price', 'volume'],
    },
    {
      name: 'stable_profile',
      url: `https://financialmodelingprep.com/stable/profile?symbol=AAPL&apikey=${apiKey}`,
      fields: ['symbol', 'companyName'],
    },
    {
      name: 'stable_news',
      url: `https://financialmodelingprep.com/stable/news?symbols=AAPL&limit=10&apikey=${apiKey}`,
      fields: ['title', 'publishedDate', 'url'],
    },
  ];

  if (INCLUDE_FMP_V3_NEWS) {
    endpoints.push({
      name: 'v3_stock_news',
      url: `https://financialmodelingprep.com/api/v3/stock_news?tickers=AAPL&limit=10&apikey=${apiKey}`,
      fields: ['title', 'publishedDate', 'url'],
    });
  }

  const endpointResults = [];

  for (const endpoint of endpoints) {
    try {
      const result = await fetchJson(endpoint.url, { timeoutMs: 15000, headers: { Accept: 'application/json' } });
      const rows = Array.isArray(result.body) ? result.body : [];
      const first = rows[0] || {};
      const fieldCheck = hasFields(first, endpoint.fields);

      endpointResults.push({
        name: endpoint.name,
        url: endpoint.url.replace(apiKey, 'REDACTED'),
        status: result.status,
        ok: result.ok,
        latencyMs: result.latencyMs,
        rowCount: rows.length,
        schemaOk: fieldCheck.ok,
        missingFields: fieldCheck.missing,
      });
    } catch (error) {
      endpointResults.push({
        name: endpoint.name,
        url: endpoint.url.replace(apiKey, 'REDACTED'),
        ok: false,
        status: null,
        latencyMs: null,
        rowCount: 0,
        schemaOk: false,
        missingFields: endpoint.fields,
        error: safeError(error),
      });
    }
  }

  let bulk = {
    ok: false,
    status: null,
    latencyMs: null,
    rowCount: 0,
    error: null,
  };

  try {
    const bulkSymbols = ['AAPL', 'MSFT', 'NVDA'];
    const startedAt = Date.now();
    const calls = await Promise.all(
      bulkSymbols.map((symbol) => fetchJson(
        `https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${apiKey}`,
        { timeoutMs: 15000, headers: { Accept: 'application/json' } }
      ))
    );
    const latencyMs = Date.now() - startedAt;
    const rowCount = calls.reduce((sum, call) => {
      const rows = Array.isArray(call.body) ? call.body : [];
      return sum + rows.length;
    }, 0);
    const allOk = calls.every((call) => call.ok);

    bulk = {
      ok: allOk && rowCount >= 3,
      status: allOk ? 200 : (calls.find((call) => !call.ok)?.status || null),
      latencyMs,
      rowCount,
      url: 'https://financialmodelingprep.com/stable/quote?symbol=<symbol>&apikey=REDACTED (x3)',
      error: allOk ? null : `status_${calls.find((call) => !call.ok)?.status || 'unknown'}`,
    };
  } catch (error) {
    bulk.error = safeError(error);
  }

  const successes = endpointResults.filter((item) => item.ok && item.schemaOk).length;
  const ready = successes >= 2 && bulk.ok;

  return {
    ready,
    reachable: successes > 0,
    endpointSuccessCount: successes,
    endpointTotal: endpointResults.length,
    bulk,
    endpoints: endpointResults,
  };
}

function buildBasicAuthHeader(username, password) {
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

async function checkStocktwits() {
  if (SKIP_STOCKTWITS) {
    return {
      skipped: true,
      ready: true,
      reachable: true,
      reason: 'skipped_by_config',
      url: process.env.STOCKTWITS_AUDIT_URL || 'https://api.stocktwits.com/api/2/streams/symbol/AAPL.json',
    };
  }

  const url = process.env.STOCKTWITS_AUDIT_URL || 'https://api.stocktwits.com/api/2/streams/symbol/AAPL.json';
  const username = process.env.STOCKTWITS_USERNAME;
  const password = process.env.STOCKTWITS_PASSWORD;
  const headers = { Accept: 'application/json' };
  let authMode = 'none';

  if (username && password) {
    headers.Authorization = buildBasicAuthHeader(username, password);
    authMode = 'basic';
  }

  try {
    const result = await fetchJson(url, { timeoutMs: 15000, headers });
    const messages = Array.isArray(result.body?.messages) ? result.body.messages : [];
    const first = messages[0] || {};
    const fieldCheck = hasFields(first, ['id', 'body', 'created_at']);

    const rateLimited = result.status === 429;
    const authIssue = result.status === 401 || result.status === 403;

    return {
      ready: result.ok && fieldCheck.ok && messages.length > 0,
      reachable: result.ok || rateLimited || authIssue,
      url,
      authMode,
      authConfigured: Boolean(username && password),
      status: result.status,
      latencyMs: result.latencyMs,
      messageCount: messages.length,
      schemaOk: fieldCheck.ok,
      missingFields: fieldCheck.missing,
      rateLimited,
      authIssue,
    };
  } catch (error) {
    return {
      ready: false,
      reachable: false,
      url,
      authMode,
      authConfigured: Boolean(username && password),
      error: safeError(error),
    };
  }
}

async function checkPolygonMassiveNews() {
  const apiKey = process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY || process.env.MASSIVE_SECRET_ACCESS_KEY;
  if (!apiKey) {
    return {
      configured: false,
      ready: false,
      reachable: false,
      skipped: true,
      reason: 'POLYGON_API_KEY (or MASSIVE_API_KEY) missing',
    };
  }

  const url = `https://api.polygon.io/v2/reference/news?ticker=AAPL&limit=10&apiKey=${apiKey}`;
  try {
    const result = await fetchJson(url, { timeoutMs: 15000, headers: { Accept: 'application/json' } });
    const rows = Array.isArray(result.body?.results) ? result.body.results : [];
    const first = rows[0] || {};
    const fieldCheck = hasFields(first, ['title', 'article_url', 'published_utc']);

    return {
      configured: true,
      ready: result.ok && rows.length > 0 && fieldCheck.ok,
      reachable: result.ok || result.status === 429,
      skipped: false,
      url: 'https://api.polygon.io/v2/reference/news?ticker=AAPL&limit=10&apiKey=REDACTED',
      status: result.status,
      latencyMs: result.latencyMs,
      rowCount: rows.length,
      schemaOk: fieldCheck.ok,
      missingFields: fieldCheck.missing,
      rateLimited: result.status === 429,
    };
  } catch (error) {
    return {
      configured: true,
      ready: false,
      reachable: false,
      skipped: false,
      url: 'https://api.polygon.io/v2/reference/news?ticker=AAPL&limit=10&apiKey=REDACTED',
      error: safeError(error),
    };
  }
}

async function checkYahooRoutesAndRss() {
  const routeFiles = [
    path.resolve(__dirname, '../routes/quotes.js'),
    path.resolve(__dirname, '../routes/options.js'),
    path.resolve(__dirname, '../routes/historical.js'),
  ];

  const routeNeedles = [
    '/api/yahoo/quote',
    '/api/yahoo/quote-batch',
    '/api/yahoo/options',
    '/api/yahoo/history',
    '/api/yahoo/search',
  ];

  const routePresence = {};
  for (const needle of routeNeedles) {
    routePresence[needle] = false;
  }

  for (const file of routeFiles) {
    const content = await fs.readFile(file, 'utf8').catch(() => '');
    for (const needle of routeNeedles) {
      if (content.includes(needle)) routePresence[needle] = true;
    }
  }

  const routePresenceOk = Object.values(routePresence).every(Boolean);

  let yahooQuoteLive = { ok: false, status: null, latencyMs: null, schemaOk: false };
  try {
    const live = await fetchJson(`${BASE_URL}/api/yahoo/quote?symbol=AAPL`, {
      timeoutMs: 15000,
      headers: { Accept: 'application/json' },
    });
    const schema = hasFields(live.body || {}, ['symbol']);
    yahooQuoteLive = {
      ok: live.ok,
      status: live.status,
      latencyMs: live.latencyMs,
      schemaOk: schema.ok,
      missingFields: schema.missing,
    };
  } catch (error) {
    yahooQuoteLive.error = safeError(error);
  }

  let yahooSearchLive = { ok: false, status: null, latencyMs: null };
  try {
    const live = await fetchJson(`${BASE_URL}/api/yahoo/search?q=apple`, {
      timeoutMs: 15000,
      headers: { Accept: 'application/json' },
    });
    yahooSearchLive = {
      ok: live.ok,
      status: live.status,
      latencyMs: live.latencyMs,
      rowCount: Array.isArray(live.body) ? live.body.length : 0,
    };
  } catch (error) {
    yahooSearchLive.error = safeError(error);
  }

  const yahooFeedUrl = 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL,MSFT,NVDA&region=US&lang=en-US';
  let yahooRss = {
    ok: false,
    url: yahooFeedUrl,
    itemCount: 0,
    latencyMs: null,
    schemaOk: false,
  };

  try {
    const startedAt = Date.now();
    const feed = await parser.parseURL(yahooFeedUrl);
    const latencyMs = Date.now() - startedAt;
    const items = Array.isArray(feed?.items) ? feed.items : [];
    const first = items[0] || {};
    const fieldCheck = hasFields(first, ['title', 'link']);
    yahooRss = {
      ok: items.length >= 5 && fieldCheck.ok,
      url: yahooFeedUrl,
      itemCount: items.length,
      latencyMs,
      schemaOk: fieldCheck.ok,
      missingFields: fieldCheck.missing,
    };
  } catch (error) {
    yahooRss.error = safeError(error);
  }

  return {
    ready: routePresenceOk && yahooQuoteLive.ok && yahooQuoteLive.schemaOk && yahooRss.ok,
    routePresenceOk,
    routes: routePresence,
    live: {
      quote: yahooQuoteLive,
      search: yahooSearchLive,
    },
    rss: yahooRss,
  };
}

async function checkRssFeeds() {
  const feeds = getRssFeedUrls();
  const results = [];

  for (const feedUrl of feeds) {
    try {
      const startedAt = Date.now();
      const feed = await parser.parseURL(feedUrl);
      const latencyMs = Date.now() - startedAt;
      const items = Array.isArray(feed?.items) ? feed.items : [];
      const first = items[0] || {};
      const fieldCheck = hasFields(first, ['title', 'link']);

      results.push({
        feedUrl,
        ok: items.length > 0,
        latencyMs,
        itemCount: items.length,
        schemaOk: fieldCheck.ok,
        missingFields: fieldCheck.missing,
      });
    } catch (error) {
      results.push({
        feedUrl,
        ok: false,
        latencyMs: null,
        itemCount: 0,
        schemaOk: false,
        error: safeError(error),
      });
    }
  }

  const passing = results.filter((item) => item.ok && item.schemaOk).length;

  return {
    ready: passing >= Math.max(1, Math.floor(results.length * 0.75)),
    totalFeeds: results.length,
    passingFeeds: passing,
    feeds: results,
  };
}

async function checkEmailWebhookIngestion() {
  const ingestKey = process.env.INTEL_INGEST_KEY;
  if (!ingestKey) {
    return {
      ready: false,
      routeReachable: false,
      error: 'INTEL_INGEST_KEY missing',
    };
  }

  const nonce = crypto.randomBytes(4).toString('hex');
  const subject = `MarketWatch Newsletter Audit ${Date.now()} ${nonce}`;
  const publishedAt = nowIso();
  const bodyText = `Newsletter catalyst test for $AAPL and (TSLA). Ref: ${nonce}`;

  const ingestResult = await fetchJson(`${BASE_URL}/api/intelligence/resend-webhook`, {
    timeoutMs: 15000,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-intel-key': ingestKey,
    },
    body: JSON.stringify({
      from: 'marketwatch-newsletter@example.com',
      subject,
      text: bodyText,
      received_at: publishedAt,
    }),
  }).catch((error) => ({
    ok: false,
    status: null,
    latencyMs: null,
    error: safeError(error),
    body: null,
  }));

  const emailRow = await queryWithTimeout(
    `SELECT id, sender, subject, source_tag, received_at
     FROM intelligence_emails
     WHERE subject = $1
     ORDER BY id DESC
     LIMIT 1`,
    [subject],
    { timeoutMs: 7000, label: 'audit.email_webhook.verify_email', maxRetries: 0 }
  ).then((res) => res.rows[0] || null).catch(() => null);

  const catalysts = await queryWithTimeout(
    `SELECT symbol, catalyst_type, headline, source, sentiment, published_at
     FROM trade_catalysts
     WHERE headline = $1
       AND catalyst_type = 'newsletter_intelligence'
     ORDER BY published_at DESC`,
    [subject],
    { timeoutMs: 7000, label: 'audit.email_webhook.verify_catalyst', maxRetries: 0 }
  ).then((res) => res.rows || []).catch(() => []);

  return {
    ready: Boolean(ingestResult.ok && emailRow && catalysts.length > 0),
    routeReachable: Boolean(ingestResult.ok),
    ingestResponse: {
      ok: ingestResult.ok,
      status: ingestResult.status,
      latencyMs: ingestResult.latencyMs,
      body: ingestResult.body,
      error: ingestResult.error || null,
    },
    dbVerification: {
      intelligenceEmailInserted: Boolean(emailRow),
      emailRow,
      catalystRows: catalysts.length,
      catalystSample: catalysts.slice(0, 3),
    },
  };
}

async function checkSchemaAndDedupe() {
  await ensureNewsStorageSchema();

  const columns = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'news_articles'
       AND column_name IN ('symbol', 'provider', 'sentiment', 'published_at', 'headline')`,
    [],
    { timeoutMs: 7000, label: 'audit.schema.columns', maxRetries: 0 }
  ).then((res) => res.rows.map((row) => row.column_name)).catch(() => []);

  const requiredColumns = ['symbol', 'provider', 'sentiment', 'published_at', 'headline'];
  const missingColumns = requiredColumns.filter((col) => !columns.includes(col));

  const marker = `AUDIT_DEDUPE_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const publishedAt = new Date().toISOString();
  const article = {
    symbol: 'AAPL',
    headline: marker,
    source: 'audit-script',
    provider: 'yahoo',
    url: `internal://audit/${marker}`,
    published_at: publishedAt,
    sentiment: 'neutral',
    summary: 'Audit dedupe validation',
    catalyst_type: 'audit_test',
    news_score: 0,
    score_breakdown: { audit: true },
    raw_payload: { marker },
  };

  const firstInsert = await insertNormalizedNewsArticle(article);
  const secondInsert = await insertNormalizedNewsArticle(article);

  const duplicateCount = await queryWithTimeout(
    `SELECT COUNT(*)::int AS count
     FROM news_articles
     WHERE headline = $1
       AND COALESCE(symbol, '') = 'AAPL'`,
    [marker],
    { timeoutMs: 7000, label: 'audit.schema.duplicate_count', maxRetries: 0 }
  ).then((res) => Number(res.rows[0]?.count || 0)).catch(() => -1);

  await queryWithTimeout(
    `DELETE FROM news_articles WHERE headline = $1`,
    [marker],
    { timeoutMs: 7000, label: 'audit.schema.cleanup', maxRetries: 0 }
  ).catch(() => null);

  const dedupeOk = firstInsert.inserted === true
    && secondInsert.inserted === false
    && secondInsert.reason === 'duplicate'
    && duplicateCount === 1;

  return {
    ready: missingColumns.length === 0 && dedupeOk,
    requiredColumns,
    presentColumns: columns,
    missingColumns,
    dedupe: {
      firstInsert,
      secondInsert,
      duplicateCount,
      dedupeOk,
    },
  };
}

function summarizeStabilityRuns(runs) {
  const total = runs.length;
  const successes = runs.filter((run) => run.ok).length;
  const rateLimited = runs.filter((run) => run.rateLimited).length;
  const errors = runs.filter((run) => !run.ok).map((run) => run.error || `status_${run.status}`);
  const latencies = runs.filter((run) => Number.isFinite(run.latencyMs)).map((run) => run.latencyMs);
  const avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : null;

  return {
    totalRuns: total,
    successes,
    successRate: total ? Number((successes / total).toFixed(2)) : 0,
    avgLatencyMs,
    rateLimitedCount: rateLimited,
    errorCount: total - successes,
    errors,
    runs,
  };
}

async function runStabilityTests() {
  const fmpKey = process.env.FMP_API_KEY;
  const polygonKey = process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY || process.env.MASSIVE_SECRET_ACCESS_KEY;

  const checks = {
    yahoo_route_quote: async () => {
      const result = await fetchJson(`${BASE_URL}/api/yahoo/quote?symbol=AAPL`, {
        timeoutMs: 15000,
        headers: { Accept: 'application/json' },
      });
      return {
        ok: result.ok && Boolean(result.body?.symbol || result.body?.regularMarketPrice || result.body?.price),
        status: result.status,
        latencyMs: result.latencyMs,
        rateLimited: result.status === 429,
        error: result.ok ? null : `status_${result.status}`,
      };
    },
    yahoo_rss: async () => {
      const rssUrl = 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL&region=US&lang=en-US';
      const startedAt = Date.now();
      const feed = await parser.parseURL(rssUrl);
      const latencyMs = Date.now() - startedAt;
      const items = Array.isArray(feed?.items) ? feed.items : [];
      return {
        ok: items.length > 0,
        status: 200,
        latencyMs,
        rateLimited: false,
        error: null,
      };
    },
  };

  if (!SKIP_FMP) {
    checks.fmp_quote = async () => {
      if (!fmpKey) return { ok: false, status: null, latencyMs: null, error: 'FMP_API_KEY missing' };
      const result = await fetchJson(`https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=${fmpKey}`, {
        timeoutMs: 15000,
        headers: { Accept: 'application/json' },
      });
      const rows = Array.isArray(result.body) ? result.body : [];
      return {
        ok: result.ok && rows.length > 0,
        status: result.status,
        latencyMs: result.latencyMs,
        rateLimited: result.status === 429,
        error: result.ok ? null : `status_${result.status}`,
      };
    };
  }

  if (polygonKey) {
    checks.polygon_news = async () => {
      const result = await fetchJson(`https://api.polygon.io/v2/reference/news?ticker=AAPL&limit=10&apiKey=${polygonKey}`, {
        timeoutMs: 15000,
        headers: { Accept: 'application/json' },
      });
      const rows = Array.isArray(result.body?.results) ? result.body.results : [];
      return {
        ok: result.ok && rows.length > 0,
        status: result.status,
        latencyMs: result.latencyMs,
        rateLimited: result.status === 429,
        error: result.ok ? null : `status_${result.status}`,
      };
    };
  }

  if (!SKIP_STOCKTWITS) {
    checks.stocktwits_stream = async () => {
      const url = process.env.STOCKTWITS_AUDIT_URL || 'https://api.stocktwits.com/api/2/streams/symbol/AAPL.json';
      const result = await fetchJson(url, { timeoutMs: 15000, headers: { Accept: 'application/json' } });
      const messages = Array.isArray(result.body?.messages) ? result.body.messages : [];
      return {
        ok: result.ok && messages.length > 0,
        status: result.status,
        latencyMs: result.latencyMs,
        rateLimited: result.status === 429,
        error: result.ok ? null : `status_${result.status}`,
      };
    };
  }

  const report = {};

  for (const [name, check] of Object.entries(checks)) {
    const runs = [];
    for (let i = 0; i < STABILITY_RUNS; i += 1) {
      try {
        const run = await check();
        runs.push({ run: i + 1, ...run });
      } catch (error) {
        runs.push({
          run: i + 1,
          ok: false,
          status: null,
          latencyMs: null,
          rateLimited: false,
          error: safeError(error).message,
        });
      }
    }
    report[name] = summarizeStabilityRuns(runs);
  }

  const readiness = Object.values(report).every((entry) => entry.successRate >= 0.8);

  return {
    ready: readiness,
    requiredSuccessRate: 0.8,
    runsPerProvider: STABILITY_RUNS,
    providers: report,
  };
}

function buildFinalVerdict(report) {
  const blockers = [];

  if (!report.providers.fmp?.skipped && !report.providers.fmp?.ready) blockers.push('FMP provider checks failed');
  if (!report.providers.stocktwits?.skipped && !report.providers.stocktwits?.ready) blockers.push('Stocktwits provider checks failed');
  if (report.providers.polygon?.configured && !report.providers.polygon.ready) blockers.push('Polygon/Massive provider checks failed');
  if (!report.providers.yahoo.ready) blockers.push('Yahoo route/RSS checks failed');
  if (!report.providers.rss.ready) blockers.push('RSS feed checks failed');
  if (!report.pipeline.emailWebhook.ready) blockers.push('Email webhook ingestion path failed');
  if (!report.pipeline.schemaAndDedupe.ready) blockers.push('News schema/dedupe validation failed');
  if (!report.stability.ready) blockers.push('Provider stability threshold not met');

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

async function main() {
  const startedAt = Date.now();
  console.log(`[AUDIT] Catalyst data source audit started at ${nowIso()}`);
  console.log(`[AUDIT] Base URL: ${BASE_URL}`);

  const report = {
    generated_at: nowIso(),
    base_url: BASE_URL,
    environment: {
      hasFmpKey: Boolean(process.env.FMP_API_KEY),
      hasIntelIngestKey: Boolean(process.env.INTEL_INGEST_KEY),
      hasStocktwitsCredentials: Boolean(process.env.STOCKTWITS_USERNAME && process.env.STOCKTWITS_PASSWORD),
      hasPolygonKey: Boolean(process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY || process.env.MASSIVE_SECRET_ACCESS_KEY),
      fmpSkipped: SKIP_FMP,
      stocktwitsSkipped: SKIP_STOCKTWITS,
      fmpV3NewsIncluded: INCLUDE_FMP_V3_NEWS,
      rssFeedCount: getRssFeedUrls().length,
    },
    providers: {},
    pipeline: {},
    stability: {},
    final: {},
  };

  report.providers.fmp = await checkFmp();
  report.providers.stocktwits = await checkStocktwits();
  report.providers.polygon = await checkPolygonMassiveNews();
  report.providers.yahoo = await checkYahooRoutesAndRss();
  report.providers.rss = await checkRssFeeds();

  report.pipeline.emailWebhook = await checkEmailWebhookIngestion();
  report.pipeline.schemaAndDedupe = await checkSchemaAndDedupe();

  report.stability = await runStabilityTests();
  report.final = buildFinalVerdict(report);
  report.runtime_ms = Date.now() - startedAt;

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify(report, null, 2));
  console.log(`Catalyst Intelligence Engine Data Sources Ready: ${report.final.ready ? 'TRUE' : 'FALSE'}`);
  console.log(`[AUDIT] Report written to: ${REPORT_PATH}`);

  if (!report.final.ready) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[AUDIT] Failed to execute catalyst data source audit:', error);
  process.exit(1);
});
