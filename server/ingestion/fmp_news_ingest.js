const Parser = require('rss-parser');
const { symbolsFromEnv } = require('./_helpers');
const { fmpFetch } = require('../services/fmpClient');
const finnhubProvider = require('../providers/finnhubProvider');
const { fetchBenzingaNews } = require('../tools/benzinga_news');
const { fetchAlphaVantageNews } = require('../tools/alpha_vantage_news');
const { promoteNewsSymbol } = require('../services/trackedUniverseService');
const logger = require('../utils/logger');
const { ensureNewsStorageSchema, insertNormalizedNewsArticle } = require('../services/newsStorage');

const parser = new Parser({ timeout: 15000 });
const DOW_JONES_FEED_URL = 'https://feeds.content.dowjones.io/public/rss/mw_topstories';

const providerHealthState = {
  checked_at: null,
  providers: {
    fmp: { provider: 'fmp', status: 'unknown', last_success: null, error_rate: 0, errors: 0, checks: 0 },
    benzinga: { provider: 'benzinga', status: 'unknown', last_success: null, error_rate: 0, errors: 0, checks: 0 },
    alpha_vantage: { provider: 'alpha_vantage', status: 'unknown', last_success: null, error_rate: 0, errors: 0, checks: 0 },
    yahoo: { provider: 'yahoo', status: 'unknown', last_success: null, error_rate: 0, errors: 0, checks: 0 },
    dowjones: { provider: 'dowjones', status: 'unknown', last_success: null, error_rate: 0, errors: 0, checks: 0 },
  },
};

function markProvider(provider, ok) {
  const entry = providerHealthState.providers[provider];
  if (!entry) return;
  entry.checks += 1;
  if (ok) {
    entry.status = 'ok';
    entry.last_success = new Date().toISOString();
  } else {
    entry.status = 'warning';
    entry.errors += 1;
  }
  entry.error_rate = entry.checks ? Number((entry.errors / entry.checks).toFixed(4)) : 0;
  providerHealthState.checked_at = new Date().toISOString();
}

function normalizeFmpRows(payload, symbol) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => ({
      symbol,
      headline: row.title || row.headline || '',
      source: row.site || row.source || 'FMP',
      provider: 'fmp',
      url: row.url || null,
      published_at: row.publishedDate || row.published_at || row.date || null,
      sentiment: row.sentiment || 'neutral',
      summary: row.text || row.summary || null,
      raw_payload: row,
    }))
    .filter((row) => row.headline && row.published_at);
}

function normalizeFinnhubRows(payload, symbol) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => ({
      symbol,
      headline: row.headline || '',
      source: row.source || 'Finnhub',
      provider: 'finnhub',
      url: row.url || null,
      published_at: row.datetime ? new Date(Number(row.datetime) * 1000).toISOString() : null,
      sentiment: 'neutral',
      summary: row.summary || null,
      raw_payload: row,
    }))
    .filter((row) => row.headline && row.published_at);
}

async function fetchYahooRssRows(symbol) {
  const feedUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  try {
    const feed = await parser.parseURL(feedUrl);
    const items = Array.isArray(feed?.items) ? feed.items : [];
    return items
      .map((item) => ({
        symbol,
        headline: item.title || '',
        source: 'Yahoo Finance',
        provider: 'yahoo',
        url: item.link || item.guid || null,
        published_at: item.isoDate || item.pubDate || null,
        sentiment: 'neutral',
        summary: item.contentSnippet || item.content || null,
        raw_payload: item,
      }))
      .filter((row) => row.headline && row.published_at);
  } catch (error) {
    logger.warn('yahoo rss ingestion failed', { symbol, error: error.message });
    return [];
  }
}

async function fetchDowJonesRssRows(symbol) {
  try {
    const feed = await parser.parseURL(DOW_JONES_FEED_URL);
    const items = Array.isArray(feed?.items) ? feed.items : [];
    return items
      .map((item) => ({
        symbol,
        headline: item.title || '',
        source: 'Dow Jones',
        provider: 'dowjones',
        url: item.link || item.guid || null,
        published_at: item.isoDate || item.pubDate || null,
        sentiment: 'neutral',
        summary: item.contentSnippet || item.content || null,
        raw_payload: item,
      }))
      .filter((row) => row.headline && row.published_at);
  } catch (error) {
    logger.warn('dowjones rss ingestion failed', { symbol, error: error.message });
    return [];
  }
}

function normalizeBenzingaRows(payload, symbol) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => ({
      symbol,
      headline: row.title || row.headline || '',
      source: row.source || 'Benzinga',
      provider: 'benzinga',
      url: row.url || row.link || row.article_url || null,
      published_at: row.created || row.updated || row.published || row.published_at || row.date || null,
      sentiment: 'neutral',
      summary: row.teaser || row.summary || row.text || null,
      raw_payload: row,
    }))
    .filter((row) => row.headline && row.published_at);
}

function normalizeAlphaVantageRows(payload, symbol) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => ({
      symbol,
      headline: row.title || row.headline || '',
      source: row.source || 'Alpha Vantage',
      provider: 'alpha_vantage',
      url: row.url || null,
      published_at: row.time_published || null,
      sentiment: 'neutral',
      summary: row.summary || null,
      raw_payload: row,
    }))
    .filter((row) => row.headline && row.published_at)
    .map((row) => {
      // Convert Alpha Vantage timestamp format YYYYMMDDTHHMMSS to ISO.
      const value = String(row.published_at || '');
      if (/^\d{8}T\d{6}$/.test(value)) {
        const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
        return { ...row, published_at: iso };
      }
      return row;
    });
}

async function fetchByFailover(symbol) {
  try {
    const fmpPayload = await fmpFetch('/news/stock-latest', {
      symbols: symbol,
      limit: 100,
    });
    const rows = normalizeFmpRows(fmpPayload, symbol);
    markProvider('fmp', rows.length > 0);
    if (rows.length > 0) return rows;
  } catch (error) {
    markProvider('fmp', false);
    logger.warn('fmp news ingestion failed', { symbol, error: error.message });
  }

  try {
    const benzinga = await fetchBenzingaNews({ tickers: symbol, pageSize: 25 });
    const rows = normalizeBenzingaRows(benzinga?.articles, symbol);
    markProvider('benzinga', rows.length > 0);
    if (rows.length > 0) return rows;
  } catch (error) {
    markProvider('benzinga', false);
    logger.warn('benzinga news ingestion failed', { symbol, error: error.message });
  }

  try {
    const alphaRows = await fetchAlphaVantageNews({ tickers: symbol, sort: 'LATEST', limit: 50 });
    const rows = normalizeAlphaVantageRows(alphaRows, symbol);
    markProvider('alpha_vantage', rows.length > 0);
    if (rows.length > 0) return rows;
  } catch (error) {
    markProvider('alpha_vantage', false);
    logger.warn('alpha vantage news ingestion failed', { symbol, error: error.message });
  }

  const yahooRows = await fetchYahooRssRows(symbol);
  markProvider('yahoo', yahooRows.length > 0);
  if (yahooRows.length > 0) return yahooRows;

  const dowJonesRows = await fetchDowJonesRssRows(symbol);
  markProvider('dowjones', dowJonesRows.length > 0);
  return dowJonesRows;
}

async function runNewsIngestion(symbols = symbolsFromEnv(), options = {}) {
  const startedAt = Date.now();
  const normalizedSymbols = (Array.isArray(symbols) ? symbols : [])
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean);
  const maxArticlesPerSymbol = Number.isFinite(Number(options.maxArticlesPerSymbol))
    ? Math.max(1, Number(options.maxArticlesPerSymbol))
    : null;

  await ensureNewsStorageSchema();

  const stats = {
    jobName: 'multi_source_news_ingest',
    symbols: normalizedSymbols.length,
    attempted: 0,
    inserted: 0,
    deduped: 0,
    byProvider: {
      fmp: 0,
      benzinga: 0,
      alpha_vantage: 0,
      yahoo: 0,
      dowjones: 0,
    },
  };

  for (const symbol of normalizedSymbols) {
    const providerRows = await fetchByFailover(symbol);

    if (!providerRows.length) {
      try {
        const finnhubPayload = await finnhubProvider.getNews(symbol);
        providerRows.push(...normalizeFinnhubRows(finnhubPayload, symbol));
      } catch (error) {
        logger.warn('finnhub news ingestion failed', { symbol, error: error.message });
      }
    }

    const rowsToInsert = maxArticlesPerSymbol ? providerRows.slice(0, maxArticlesPerSymbol) : providerRows;

    for (const article of rowsToInsert) {
      stats.attempted += 1;
      const result = await insertNormalizedNewsArticle(article);
      if (result.inserted) {
        stats.inserted += 1;
        const provider = article.provider || 'fmp';
        if (Object.prototype.hasOwnProperty.call(stats.byProvider, provider)) {
          stats.byProvider[provider] += 1;
        }
        if (article.symbol) {
          await promoteNewsSymbol(article.symbol).catch((error) => {
            logger.warn('news symbol promotion failed', { symbol: article.symbol, error: error.message });
          });
        }
      } else if (result.reason === 'duplicate') {
        stats.deduped += 1;
      }
    }
  }

  stats.durationMs = Date.now() - startedAt;
  logger.info('news ingestion complete', stats);
  return stats;
}

module.exports = {
  runNewsIngestion,
  getNewsProviderHealth: () => ({
    checked_at: providerHealthState.checked_at,
    providers: providerHealthState.providers,
  }),
};
