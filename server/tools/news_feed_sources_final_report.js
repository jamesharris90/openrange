/* eslint-disable no-console */
const fs = require('fs/promises');
const path = require('path');
const Parser = require('rss-parser');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const REPORT_PATH = path.resolve(__dirname, '../reports/news_feed_sources_final_report.json');
const parser = new Parser({ timeout: 15000 });
const ENABLE_FINNHUB_SOCIAL = String(process.env.ENABLE_FINNHUB_SOCIAL || '').toLowerCase() === 'true';

function nowIso() {
  return new Date().toISOString();
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function safeError(error) {
  return {
    message: String(error?.message || error || 'Unknown error'),
    code: error?.code || null,
  };
}

async function fetchJson(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const latencyMs = Date.now() - startedAt;
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    latencyMs,
    body,
  };
}

function summarizeArrayPayload(payload) {
  const arr = Array.isArray(payload) ? payload : [];
  const first = arr[0] || {};
  return {
    rowCount: arr.length,
    sampleFields: Object.keys(first).slice(0, 8),
  };
}

function detectProviderMessage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body['Error Message'] || body.Note || body.Information || body.error || null;
}

async function testFmpEndpoints() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return {
      ready: false,
      error: 'FMP_API_KEY missing',
      endpoints: [],
    };
  }

  const endpoints = [
    {
      name: 'fmp_articles',
      url: `https://financialmodelingprep.com/stable/fmp-articles?page=0&limit=20&apikey=${apiKey}`,
    },
    {
      name: 'general_latest',
      url: `https://financialmodelingprep.com/stable/news/general-latest?page=0&limit=20&apikey=${apiKey}`,
    },
    {
      name: 'press_releases_latest',
      url: `https://financialmodelingprep.com/stable/news/press-releases-latest?page=0&limit=20&apikey=${apiKey}`,
    },
    {
      name: 'stock_latest',
      url: `https://financialmodelingprep.com/stable/news/stock-latest?page=0&limit=20&apikey=${apiKey}`,
    },
    {
      name: 'press_releases_symbol',
      url: `https://financialmodelingprep.com/stable/news/press-releases?symbols=AAPL&apikey=${apiKey}`,
    },
    {
      name: 'stock_symbol',
      url: `https://financialmodelingprep.com/stable/news/stock?symbols=AAPL&apikey=${apiKey}`,
    },
  ];

  const results = [];

  for (const endpoint of endpoints) {
    try {
      const result = await fetchJson(endpoint.url);
      const summary = summarizeArrayPayload(result.body);
      const providerMessage = detectProviderMessage(result.body);
      results.push({
        name: endpoint.name,
        url: endpoint.url.replace(apiKey, 'REDACTED'),
        ok: result.ok && summary.rowCount > 0,
        status: result.status,
        latencyMs: result.latencyMs,
        rowCount: summary.rowCount,
        sampleFields: summary.sampleFields,
        providerMessage,
      });
    } catch (error) {
      results.push({
        name: endpoint.name,
        url: endpoint.url.replace(apiKey, 'REDACTED'),
        ok: false,
        status: null,
        latencyMs: null,
        rowCount: 0,
        sampleFields: [],
        error: safeError(error),
      });
    }
  }

  return {
    ready: results.every((item) => item.ok),
    passing: results.filter((item) => item.ok).length,
    total: results.length,
    endpoints: results,
  };
}

function extractSocialRows(rows = []) {
  return rows.map((row) => ({
    mention: Number(row?.mention || row?.mentions || 0),
    positiveScore: Number(row?.positiveScore || 0),
    negativeScore: Number(row?.negativeScore || 0),
  }));
}

function aggregateSentiment(rows = []) {
  const totalMentions = rows.reduce((sum, row) => sum + (Number.isFinite(row.mention) ? row.mention : 0), 0);
  const avgPositive = rows.length
    ? rows.reduce((sum, row) => sum + (Number.isFinite(row.positiveScore) ? row.positiveScore : 0), 0) / rows.length
    : 0;
  const avgNegative = rows.length
    ? rows.reduce((sum, row) => sum + (Number.isFinite(row.negativeScore) ? row.negativeScore : 0), 0) / rows.length
    : 0;
  const imbalance = Number((avgPositive - avgNegative).toFixed(4));

  let signal = 'neutral';
  if (imbalance >= 0.2 && totalMentions >= 5) signal = 'bullish_extreme';
  if (imbalance <= -0.2 && totalMentions >= 5) signal = 'bearish_extreme';

  return {
    rows: rows.length,
    totalMentions,
    avgPositive: Number(avgPositive.toFixed(4)),
    avgNegative: Number(avgNegative.toFixed(4)),
    imbalance,
    signal,
  };
}

async function testFinnhubSocialSentiment() {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return {
      ready: false,
      error: 'FINNHUB_API_KEY missing',
      fromDate: null,
      toDate: null,
      tickers: [],
    };
  }

  const tickers = ['AAPL', 'TSLA', 'NVDA', 'COIN', 'MSFT'];
  const to = new Date();
  const from = new Date(Date.now() - (12 * 60 * 60 * 1000));
  const toDate = toDateOnly(to);
  const fromDate = toDateOnly(from);

  const results = [];

  for (const ticker of tickers) {
    const url = `https://finnhub.io/api/v1/stock/social-sentiment?symbol=${ticker}&from=${fromDate}&to=${toDate}&token=${apiKey}`;
    try {
      const result = await fetchJson(url);
      const body = result.body && typeof result.body === 'object' ? result.body : {};
      const redditRows = extractSocialRows(Array.isArray(body.reddit) ? body.reddit : []);
      const twitterRows = extractSocialRows(Array.isArray(body.twitter) ? body.twitter : []);

      const reddit = aggregateSentiment(redditRows);
      const twitter = aggregateSentiment(twitterRows);
      const providerMessage = detectProviderMessage(body);

      results.push({
        ticker,
        ok: result.ok,
        status: result.status,
        latencyMs: result.latencyMs,
        reddit,
        twitter,
        providerMessage,
      });
    } catch (error) {
      results.push({
        ticker,
        ok: false,
        status: null,
        latencyMs: null,
        error: safeError(error),
      });
    }
  }

  return {
    ready: results.every((item) => item.ok),
    fromDate,
    toDate,
    tickers: results,
  };
}

function buildActiveNewsStack(sources) {
  const stack = [];
  const removed = [];

  const fmpEndpoints = Array.isArray(sources?.fmp?.endpoints) ? sources.fmp.endpoints : [];
  for (const endpoint of fmpEndpoints) {
    if (endpoint.ok) {
      stack.push({ provider: 'fmp', source: endpoint.name, status: 'active' });
    } else {
      removed.push({ provider: 'fmp', source: endpoint.name, reason: endpoint.providerMessage || endpoint.error?.message || `status_${endpoint.status || 'n/a'}` });
    }
  }

  const rssFeeds = Array.isArray(sources?.rss?.feeds) ? sources.rss.feeds : [];
  for (const feed of rssFeeds) {
    if (feed.ok) {
      stack.push({ provider: 'rss', source: feed.feedUrl, status: 'active' });
    } else {
      removed.push({ provider: 'rss', source: feed.feedUrl, reason: feed.error?.message || `status_${feed.status || 'n/a'}` });
    }
  }

  if (sources?.alphaVantage?.ready) {
    stack.push({ provider: 'alpha_vantage', source: 'news_sentiment_feed', status: 'active' });
  } else {
    removed.push({ provider: 'alpha_vantage', source: 'news_sentiment_feed', reason: sources?.alphaVantage?.error?.message || 'not_ready' });
  }

  if (sources?.benzinga?.ready) {
    stack.push({ provider: 'benzinga', source: 'api/v2/news', status: 'active' });
  } else {
    removed.push({ provider: 'benzinga', source: 'api/v2/news', reason: sources?.benzinga?.error?.message || `status_${sources?.benzinga?.status || 'n/a'}` });
  }

  if (ENABLE_FINNHUB_SOCIAL) {
    const rows = Array.isArray(sources?.finnhubSocial?.tickers) ? sources.finnhubSocial.tickers : [];
    const okRows = rows.filter((row) => row.ok);
    const badRows = rows.filter((row) => !row.ok);

    if (okRows.length > 0) {
      stack.push({ provider: 'finnhub', source: 'stock/social-sentiment', status: 'active', workingTickers: okRows.map((row) => row.ticker) });
    }
    for (const row of badRows) {
      removed.push({ provider: 'finnhub', source: `stock/social-sentiment:${row.ticker}`, reason: row.providerMessage || row.error?.message || `status_${row.status || 'n/a'}` });
    }
  } else {
    removed.push({ provider: 'finnhub', source: 'stock/social-sentiment', reason: 'disabled_by_config' });
  }

  return { stack, removed };
}

async function testAlphaVantage() {
  try {
    const { fetchAlphaVantageNews } = require('./alpha_vantage_news');
    const feed = await fetchAlphaVantageNews({ limit: 20, sort: 'LATEST' });
    return {
      ready: Array.isArray(feed),
      rowCount: Array.isArray(feed) ? feed.length : 0,
      sampleTitle: feed?.[0]?.title || null,
    };
  } catch (error) {
    return {
      ready: false,
      error: safeError(error),
    };
  }
}

async function testBenzinga() {
  try {
    const { fetchBenzingaNews } = require('./benzinga_news');
    const result = await fetchBenzingaNews({ tickers: 'AAPL,TSLA', pageSize: 10 });
    return {
      ready: result.count > 0,
      status: 200,
      rowCount: result.count,
      sample: result.articles.slice(0, 5).map((article) => ({
        title: article?.title || article?.headline || null,
        teaser: article?.teaser || article?.summary || article?.text || null,
        published: article?.created || article?.updated || article?.published || article?.published_at || article?.date || null,
        url: article?.url || article?.link || article?.article_url || null,
      })),
    };
  } catch (error) {
    return {
      ready: false,
      error: safeError(error),
    };
  }
}

async function testRssFeeds() {
  const feedUrls = [
    'https://feeds.content.dowjones.io/public/rss/mw_topstories',
    'https://feeds.content.dowjones.io/public/rss/mw_bulletins',
    'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',
    'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC,^IXIC,^DJI&region=US&lang=en-US',
  ];

  const results = [];
  for (const feedUrl of feedUrls) {
    try {
      const startedAt = Date.now();
      const feed = await parser.parseURL(feedUrl);
      const latencyMs = Date.now() - startedAt;
      const items = Array.isArray(feed?.items) ? feed.items : [];
      results.push({
        feedUrl,
        ok: items.length > 0,
        latencyMs,
        rowCount: items.length,
        sampleTitle: items[0]?.title || null,
      });
    } catch (error) {
      results.push({
        feedUrl,
        ok: false,
        latencyMs: null,
        rowCount: 0,
        error: safeError(error),
      });
    }
  }

  return {
    ready: results.every((item) => item.ok),
    feeds: results,
  };
}

async function main() {
  console.log('[NEWS-CHECK] Running final news source report...');

  const report = {
    generatedAt: nowIso(),
    config: {
      enableFinnhubSocial: ENABLE_FINNHUB_SOCIAL,
    },
    sources: {},
    activeStack: [],
    removedSources: [],
    final: {},
  };

  report.sources.fmp = await testFmpEndpoints();
  report.sources.finnhubSocial = ENABLE_FINNHUB_SOCIAL
    ? await testFinnhubSocialSentiment()
    : { ready: true, skipped: true, reason: 'disabled_by_config', tickers: [] };
  report.sources.alphaVantage = await testAlphaVantage();
  report.sources.benzinga = await testBenzinga();
  report.sources.rss = await testRssFeeds();

  const stackResult = buildActiveNewsStack(report.sources);
  report.activeStack = stackResult.stack;
  report.removedSources = stackResult.removed;

  const blockers = [];
  if (report.activeStack.length === 0) blockers.push('No working news sources available');

  report.final = {
    ready: blockers.length === 0,
    blockers,
  };

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  if (ENABLE_FINNHUB_SOCIAL) {
    console.log('\n[Finnhub Social Sentiment Summary | last 12h window]');
    const finnhubRows = report.sources.finnhubSocial.tickers || [];
    for (const row of finnhubRows) {
      if (!row.ok) {
        console.log(`- ${row.ticker}: FAILED status=${row.status ?? 'n/a'} error=${row.error?.message || 'unknown'}`);
        continue;
      }
      console.log(
        `- ${row.ticker}: reddit_mentions=${row.reddit.totalMentions} twitter_mentions=${row.twitter.totalMentions} reddit_signal=${row.reddit.signal} twitter_signal=${row.twitter.signal} reddit_imbalance=${row.reddit.imbalance} twitter_imbalance=${row.twitter.imbalance}`
      );
    }
  }

  console.log('\n[NEWS-CHECK] Active working news stack');
  for (const source of report.activeStack) {
    console.log(`- ${source.provider}: ${source.source}`);
  }

  console.log('\n[NEWS-CHECK] Removed non-working or disabled sources');
  for (const source of report.removedSources) {
    console.log(`- ${source.provider}: ${source.source} (${source.reason})`);
  }

  console.log('\n[NEWS-CHECK] Final JSON report');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nNews Feed Sources Ready: ${report.final.ready ? 'TRUE' : 'FALSE'}`);
  console.log(`[NEWS-CHECK] Report written to ${REPORT_PATH}`);

  if (!report.final.ready) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[NEWS-CHECK] Fatal error:', error);
  process.exit(1);
});
