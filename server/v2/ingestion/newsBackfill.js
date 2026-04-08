const axios = require('axios');

const { supabaseAdmin } = require('../../services/supabaseClient');

const TARGET_SYMBOL_LIMIT = 200;
const RUN_SYMBOL_LIMIT = 50;
const MAX_ARTICLES_PER_SYMBOL = 10;
const REQUEST_TIMEOUT_MS = 1500;

const httpClient = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  validateStatus: () => true,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  },
});

let backfillInFlight = false;

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSymbol(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

function resolveDateToken(dateToken, previousDateToken) {
  const trimmed = String(dateToken || '').trim();
  if (!trimmed) return previousDateToken || null;
  if (/^(Today|Yesterday)\b/i.test(trimmed) || /^[A-Z][a-z]{2}-\d{2}-\d{2}\b/.test(trimmed)) {
    return trimmed;
  }
  return previousDateToken || null;
}

function parseFinvizTimestamp(dateCell, previousDateToken) {
  const trimmed = String(dateCell || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return { publishedAt: null, dateToken: previousDateToken || null };
  }

  const pieces = trimmed.split(' ');
  let nextDateToken = previousDateToken || null;
  let timeToken = null;

  if (pieces.length >= 2) {
    nextDateToken = resolveDateToken(`${pieces[0]}${pieces[1] && pieces[0].match(/^Today|Yesterday$/i) ? ' ' + pieces[1] : ''}`.trim(), previousDateToken);
  }

  if (/^(Today|Yesterday)$/i.test(pieces[0])) {
    nextDateToken = pieces[0];
    timeToken = pieces[1] || null;
  } else if (/^[A-Z][a-z]{2}-\d{2}-\d{2}$/.test(pieces[0])) {
    nextDateToken = pieces[0];
    timeToken = pieces[1] || null;
  } else {
    timeToken = pieces[0] || null;
  }

  if (!timeToken || !nextDateToken) {
    return { publishedAt: null, dateToken: nextDateToken };
  }

  const now = new Date();
  let baseDate;
  if (/^Today$/i.test(nextDateToken)) {
    baseDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  } else if (/^Yesterday$/i.test(nextDateToken)) {
    baseDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  } else {
    const parsedDate = new Date(`${nextDateToken} UTC`);
    if (Number.isNaN(parsedDate.getTime())) {
      return { publishedAt: null, dateToken: nextDateToken };
    }
    baseDate = parsedDate;
  }

  const timeMatch = timeToken.match(/^(\d{1,2}):(\d{2})(AM|PM)$/i);
  if (!timeMatch) {
    return { publishedAt: null, dateToken: nextDateToken };
  }

  let hours = Number(timeMatch[1]) % 12;
  if (timeMatch[3].toUpperCase() === 'PM') {
    hours += 12;
  }
  const minutes = Number(timeMatch[2]);
  baseDate.setUTCHours(hours, minutes, 0, 0);

  return {
    publishedAt: baseDate.toISOString(),
    dateToken: nextDateToken,
  };
}

function parseYahooQuoteNewsHtml(html) {
  const results = [];
  const articleMatches = String(html || '').match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi) || [];

  for (const anchor of articleMatches) {
    const hrefMatch = anchor.match(/href="([^"]+)"/i);
    const titleText = decodeHtml(anchor.replace(/<[^>]+>/g, ' '));
    if (!hrefMatch || !titleText) {
      continue;
    }

    const url = hrefMatch[1].startsWith('http') ? hrefMatch[1] : `https://finance.yahoo.com${hrefMatch[1]}`;
    if (!/\/news\//i.test(url) && !/\/video\//i.test(url) && !/\/m\//i.test(url) && !/\/markets\//i.test(url)) {
      continue;
    }

    if (results.some((row) => row.url === url || row.headline === titleText)) {
      continue;
    }

    results.push({
      headline: titleText,
      url,
      published_at: null,
      source: 'Yahoo Finance',
    });

    if (results.length >= MAX_ARTICLES_PER_SYMBOL) {
      break;
    }
  }

  return results;
}

function parseFinvizHtml(html) {
  const rows = [];
  const tableMatch = String(html || '').match(/<table[^>]+id="news-table"[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    return rows;
  }

  const rowMatches = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
  let previousDateToken = null;

  for (const rowHtml of rowMatches) {
    const dateMatch = rowHtml.match(/<td[^>]*align="right"[^>]*>([\s\S]*?)<\/td>/i);
    const linkMatch = rowHtml.match(/<a[^>]+class="tab-link-news"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const sourceMatch = rowHtml.match(/<span>\(([^)]+)\)<\/span>/i);

    if (!dateMatch || !linkMatch) {
      continue;
    }

    const dateCell = decodeHtml(dateMatch[1]);
    const parsedTimestamp = parseFinvizTimestamp(dateCell, previousDateToken);
    previousDateToken = parsedTimestamp.dateToken;

    const headline = decodeHtml(linkMatch[2].replace(/<[^>]+>/g, ' '));
    const url = linkMatch[1];
    if (!headline || !url || !parsedTimestamp.publishedAt) {
      continue;
    }

    rows.push({
      headline,
      url,
      published_at: parsedTimestamp.publishedAt,
      source: sourceMatch ? decodeHtml(sourceMatch[1]) : 'Finviz',
    });

    if (rows.length >= MAX_ARTICLES_PER_SYMBOL) {
      break;
    }
  }

  return rows;
}

async function fetchTargetSymbols(explicitSymbols) {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client unavailable');
  }

  if (Array.isArray(explicitSymbols) && explicitSymbols.length > 0) {
    const seen = new Set();
    const normalized = [];
    for (const rawSymbol of explicitSymbols) {
      const symbol = normalizeSymbol(rawSymbol);
      if (!symbol || seen.has(symbol)) {
        continue;
      }
      seen.add(symbol);
      normalized.push(symbol);
    }
    return normalized.slice(0, RUN_SYMBOL_LIMIT);
  }

  const metricsResult = await supabaseAdmin
    .from('market_metrics')
    .select('symbol, volume')
    .not('symbol', 'is', null)
    .order('volume', { ascending: false })
    .limit(TARGET_SYMBOL_LIMIT);

  if (metricsResult.error) {
    throw new Error(metricsResult.error.message || 'Failed to load market_metrics targets');
  }

  const symbols = [];
  const seen = new Set();
  for (const row of metricsResult.data || []) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol || seen.has(symbol)) {
      continue;
    }
    seen.add(symbol);
    symbols.push(symbol);
  }

  const latestNewsBySymbol = new Map();
  let from = 0;
  const pageSize = 1000;

  while (latestNewsBySymbol.size < symbols.length) {
    const newsResult = await supabaseAdmin
      .from('news_articles')
      .select('symbol, published_at')
      .in('symbol', symbols)
      .not('symbol', 'is', null)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (newsResult.error) {
      throw new Error(newsResult.error.message || 'Failed to load latest news timestamps');
    }

    const batch = Array.isArray(newsResult.data) ? newsResult.data : [];
    if (batch.length === 0) {
      break;
    }

    for (const row of batch) {
      const symbol = normalizeSymbol(row.symbol);
      if (!symbol || latestNewsBySymbol.has(symbol) || !row.published_at) {
        continue;
      }
      latestNewsBySymbol.set(symbol, row.published_at);
    }

    if (batch.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  return symbols.filter((symbol) => {
    const latestNewsAt = latestNewsBySymbol.get(symbol);
    if (!latestNewsAt) {
      return true;
    }
    const parsed = Date.parse(latestNewsAt);
    return Number.isNaN(parsed) || parsed < cutoff;
  }).slice(0, RUN_SYMBOL_LIMIT);
}

async function fetchExistingHeadlines(symbol) {
  const existing = new Set();
  let from = 0;
  const pageSize = 500;

  while (true) {
    const result = await supabaseAdmin
      .from('news_articles')
      .select('headline')
      .eq('symbol', symbol)
      .range(from, from + pageSize - 1);

    if (result.error) {
      throw new Error(result.error.message || `Failed to load existing headlines for ${symbol}`);
    }

    const batch = Array.isArray(result.data) ? result.data : [];
    for (const row of batch) {
      if (row?.headline) {
        existing.add(String(row.headline).trim());
      }
    }

    if (batch.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return existing;
}

async function fetchYahooBackfillArticles(symbol) {
  const response = await httpClient.get(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/news`, {
    responseType: 'text',
  });

  if (response.status < 200 || response.status >= 300) {
    return [];
  }

  return parseYahooQuoteNewsHtml(response.data).slice(0, MAX_ARTICLES_PER_SYMBOL);
}

async function fetchFinvizBackfillArticles(symbol) {
  const response = await httpClient.get('https://finviz.com/quote.ashx', {
    params: { t: symbol },
    responseType: 'text',
  });

  if (response.status < 200 || response.status >= 300) {
    return [];
  }

  return parseFinvizHtml(response.data).slice(0, MAX_ARTICLES_PER_SYMBOL);
}

async function insertBackfillArticle(symbol, article, source) {
  const payload = {
    headline: article.headline,
    title: article.headline,
    source,
    published_at: article.published_at,
    published_date: article.published_at,
    url: article.url,
    source_url: article.url,
    symbol,
    symbols: [symbol],
    provider: article.source,
    source_type: 'BACKFILL',
    created_at: new Date().toISOString(),
    ingested_at: new Date().toISOString(),
  };

  const result = await supabaseAdmin.from('news_articles').insert(payload);
  if (result.error) {
    throw new Error(result.error.message || `Failed to insert ${source} article for ${symbol}`);
  }
}

async function runNewsBackfill(options = {}) {
  if (backfillInFlight) {
    return {
      success: false,
      reason: 'already_running',
      symbols_scanned: 0,
      inserted: 0,
      duplicates: 0,
      no_news_found: [],
    };
  }

  backfillInFlight = true;
  console.log('[NEWS_BACKFILL] started');

  try {
    const symbols = await fetchTargetSymbols(options.symbols);
    let inserted = 0;
    let duplicates = 0;
    let errors = 0;
    const noNewsFound = [];

    for (const symbol of symbols) {
      let existingHeadlines;
      try {
        existingHeadlines = await fetchExistingHeadlines(symbol);
      } catch (error) {
        console.warn('[NEWS_BACKFILL] existing headline lookup failed', { symbol, error: error.message });
        errors += 1;
        continue;
      }

      let articles = [];
      let source = 'yahoo_backfill';

      try {
        articles = await fetchYahooBackfillArticles(symbol);
      } catch (error) {
        console.warn('[NEWS_BACKFILL] Yahoo fetch failed', { symbol, error: error.message });
      }

      if (articles.length === 0) {
        source = 'finviz_backfill';
        try {
          articles = await fetchFinvizBackfillArticles(symbol);
        } catch (error) {
          console.warn('[NEWS_BACKFILL] Finviz fetch failed', { symbol, error: error.message });
        }
      }

      if (articles.length === 0) {
        noNewsFound.push(symbol);
        continue;
      }

      for (const article of articles) {
        if (!article.headline || !article.published_at || !article.url) {
          continue;
        }

        if (existingHeadlines.has(article.headline)) {
          duplicates += 1;
          continue;
        }

        try {
          await insertBackfillArticle(symbol, article, source);
          existingHeadlines.add(article.headline);
          inserted += 1;
        } catch (error) {
          console.warn('[NEWS_BACKFILL] insert failed', { symbol, headline: article.headline, error: error.message });
          errors += 1;
        }
      }
    }

    const summary = {
      success: true,
      symbols_scanned: symbols.length,
      inserted,
      duplicates,
      errors,
      no_news_found: noNewsFound,
    };

    console.log('[NEWS_BACKFILL] completed', summary);
    return summary;
  } finally {
    backfillInFlight = false;
  }
}

module.exports = {
  runNewsBackfill,
};
