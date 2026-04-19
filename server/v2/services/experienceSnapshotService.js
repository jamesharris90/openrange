const { queryWithTimeout } = require('../../db/pg');
const { getCache, setCache } = require('../cache/memoryCache');
const { getCachedScreenerPayload } = require('./snapshotService');
const { emptyResearchData, buildMCP, normalizeSymbol } = require('./researchService');

const NEWS_SNAPSHOT_KEY = 'experience:news:snapshot:v1';
const EARNINGS_SNAPSHOT_KEY = 'experience:earnings:snapshot:v1';
const NEWS_SNAPSHOT_TTL_MS = 60_000;
const EARNINGS_SNAPSHOT_TTL_MS = 60_000;
const RESEARCH_FAST_TTL_MS = 120_000;
const NEWS_SNAPSHOT_LIMIT = 1000;
const EARNINGS_SNAPSHOT_LIMIT = 5000;

let newsRefreshPromise = null;
let earningsRefreshPromise = null;
let newsSchedulerStarted = false;
let earningsSchedulerStarted = false;

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeFastHistoryRow(symbol, row) {
  const reportDate = row?.report_date ? String(row.report_date).slice(0, 10) : null;
  if (!reportDate) {
    return null;
  }

  return {
    symbol,
    report_date: reportDate,
    report_time: String(row?.report_time || 'TBD').trim() || 'TBD',
    eps_estimate: toNullableNumber(row?.eps_estimate),
    eps_actual: toNullableNumber(row?.eps_actual),
    revenue_estimate: toNullableNumber(row?.revenue_estimate),
    revenue_actual: toNullableNumber(row?.revenue_actual),
    market_cap: toNullableNumber(row?.market_cap),
    sector: toNullableString(row?.sector),
    industry: toNullableString(row?.industry),
  };
}

async function loadFastResearchSupplements(symbol) {
  const warnings = [];
  const pushWarning = (warning) => {
    if (!warnings.includes(warning)) {
      warnings.push(warning);
    }
  };

  const [companyResult, nextResult, historyResult] = await Promise.all([
    queryWithTimeout(
      `SELECT
         COALESCE(cp.company_name, tu.company_name) AS company_name,
         COALESCE(cp.sector, tu.sector) AS sector,
         COALESCE(cp.industry, tu.industry) AS industry,
         cp.description,
         COALESCE(cp.exchange, tu.exchange) AS exchange,
         cp.country,
         cp.website
       FROM ticker_universe tu
       FULL OUTER JOIN company_profiles cp ON UPPER(cp.symbol) = UPPER(tu.symbol)
       WHERE UPPER(COALESCE(cp.symbol, tu.symbol)) = $1
       LIMIT 1`,
      [symbol],
      {
        timeoutMs: 4000,
        label: 'experience.research.company_supplement',
        maxRetries: 0,
      }
    ).catch(() => {
      pushWarning('company_data_timeout');
      return { rows: [] };
    }),
    queryWithTimeout(
      `SELECT
         symbol,
         report_date::text AS report_date,
         COALESCE(NULLIF(report_time, ''), NULLIF(time, ''), 'TBD') AS report_time,
         eps_estimate,
         COALESCE(revenue_estimate, rev_estimate) AS revenue_estimate,
         market_cap,
         sector,
         industry
       FROM earnings_events
       WHERE UPPER(symbol) = $1
         AND report_date >= CURRENT_DATE
       ORDER BY report_date ASC
       LIMIT 1`,
      [symbol],
      {
        timeoutMs: 4000,
        label: 'experience.research.next_earnings',
        maxRetries: 0,
      }
    ).catch(() => {
      pushWarning('earnings_supplement_timeout');
      return { rows: [] };
    }),
    queryWithTimeout(
      `SELECT
         report_date::text AS report_date,
         COALESCE(NULLIF(report_time, ''), 'TBD') AS report_time,
         eps_estimate,
         eps_actual,
         revenue_estimate,
         revenue_actual
       FROM earnings_history
       WHERE UPPER(symbol) = $1
       ORDER BY report_date DESC
       LIMIT 4`,
      [symbol],
      {
        timeoutMs: 4000,
        label: 'experience.research.history',
        maxRetries: 0,
      }
    ).catch(() => {
      pushWarning('earnings_supplement_timeout');
      return { rows: [] };
    }),
  ]);

  const company = companyResult.rows?.[0] || {};
  const nextEarningsRow = nextResult.rows?.[0] || null;
  const history = (historyResult.rows || [])
    .map((row) => normalizeFastHistoryRow(symbol, row))
    .filter(Boolean);

  return {
    company: {
      company_name: toNullableString(company.company_name),
      sector: toNullableString(company.sector),
      industry: toNullableString(company.industry),
      exchange: toNullableString(company.exchange),
      country: toNullableString(company.country),
      website: toNullableString(company.website),
      description: toNullableString(company.description),
    },
    next: nextEarningsRow ? normalizeFastHistoryRow(symbol, nextEarningsRow) : null,
    history,
    warnings,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseWindowToHours(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === '24h' || normalized === 'today') return 24;
  if (normalized === '7d') return 24 * 7;
  if (normalized === '30d') return 24 * 30;
  const hoursMatch = normalized.match(/^(\d+)h$/);
  if (hoursMatch) return Number(hoursMatch[1]);
  const daysMatch = normalized.match(/^(\d+)d$/);
  if (daysMatch) return Number(daysMatch[1]) * 24;
  return 24;
}

function articlePublishedAt(row) {
  const value = row?.published_at || row?.published_date || row?.created_at || null;
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeNewsArticle(row) {
  const headline = String(row?.headline || row?.title || '').trim();
  if (!headline) {
    return null;
  }

  const symbols = Array.isArray(row?.symbols)
    ? row.symbols.map((entry) => String(entry || '').trim().toUpperCase()).filter(Boolean)
    : [];
  const primarySymbol = String(row?.symbol || symbols[0] || '').trim().toUpperCase() || null;
  const normalizedSymbols = primarySymbol && !symbols.includes(primarySymbol)
    ? [primarySymbol, ...symbols]
    : symbols;
  const type = primarySymbol || normalizedSymbols.length ? 'stock' : 'macro';
  const publishedAt = articlePublishedAt(row);

  return {
    id: String(row?.id || row?.source_id || row?.url || `${headline}-${publishedAt || 'unknown'}`),
    source_id: row?.source_id ? String(row.source_id) : null,
    symbol: type === 'macro' ? null : primarySymbol,
    symbols: normalizedSymbols,
    type,
    headline,
    title: headline,
    summary: String(row?.summary || '').trim() || null,
    source: String(row?.source || row?.publisher || row?.provider || 'News').trim() || 'News',
    publisher: String(row?.publisher || '').trim() || null,
    provider: String(row?.provider || '').trim() || null,
    url: String(row?.url || '').trim() || null,
    published_at: publishedAt,
    publishedAt,
    sentiment: String(row?.sentiment || '').trim() || null,
    catalyst_type: String(row?.catalyst_type || '').trim() || null,
    sector: String(row?.sector || '').trim() || null,
    news_score: Number.isFinite(Number(row?.news_score)) ? Number(row.news_score) : null,
  };
}

function normalizeEarningsRow(row) {
  const reportDate = row?.report_date ? String(row.report_date).slice(0, 10) : null;
  if (!reportDate) {
    return null;
  }

  return {
    symbol: String(row?.symbol || '').trim().toUpperCase() || null,
    company_name: String(row?.company_name || '').trim() || null,
    report_date: reportDate,
    time: String(row?.time || row?.report_time || 'TBD').trim() || 'TBD',
    report_time: String(row?.time || row?.report_time || 'TBD').trim() || 'TBD',
    eps_estimate: Number.isFinite(Number(row?.eps_estimate)) ? Number(row.eps_estimate) : null,
    eps_actual: Number.isFinite(Number(row?.eps_actual)) ? Number(row.eps_actual) : null,
    revenue_estimate: Number.isFinite(Number(row?.revenue_estimate)) ? Number(row.revenue_estimate) : null,
    revenue_actual: Number.isFinite(Number(row?.revenue_actual)) ? Number(row.revenue_actual) : null,
    expected_move_percent: Number.isFinite(Number(row?.expected_move_percent)) ? Number(row.expected_move_percent) : null,
    market_cap: Number.isFinite(Number(row?.market_cap)) ? Number(row.market_cap) : null,
    sector: String(row?.sector || '').trim() || null,
    industry: String(row?.industry || '').trim() || null,
    score: Number.isFinite(Number(row?.score)) ? Number(row.score) : null,
    source: String(row?.source || 'db').trim() || 'db',
    updated_at: row?.updated_at || null,
  };
}

function dedupeNewsRows(rows) {
  const seen = new Set();
  const deduped = [];

  for (const row of rows) {
    if (!row) {
      continue;
    }

    const key = String(row.id || `${row.url || ''}-${row.published_at || ''}-${row.title || ''}`);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

async function loadNewsSnapshotRows(cutoffIso, limit) {
  const rows = [];

  const publishedAtResult = await queryWithTimeout(
    `SELECT
       id,
       UPPER(COALESCE(symbol, '')) AS symbol,
       COALESCE(symbols, ARRAY[]::text[]) AS symbols,
       COALESCE(title, headline) AS title,
       headline,
       summary,
       COALESCE(source, publisher, provider, 'News') AS source,
       publisher,
       provider,
       url,
       published_at,
       sentiment,
       catalyst_type,
       sector,
       news_score,
       source_type,
       created_at
     FROM news_articles
     WHERE published_at >= $1
     ORDER BY published_at DESC
     LIMIT $2`,
    [cutoffIso, limit],
    {
      timeoutMs: 5000,
      label: 'experience.news.snapshot.published_at',
      maxRetries: 1,
    }
  );

  rows.push(...(publishedAtResult.rows || []));

  const remainingAfterPublishedAt = Math.max(0, limit - rows.length);
  if (remainingAfterPublishedAt > 0) {
    const publishedDateResult = await queryWithTimeout(
      `SELECT
         id,
         UPPER(COALESCE(symbol, '')) AS symbol,
         COALESCE(symbols, ARRAY[]::text[]) AS symbols,
         COALESCE(title, headline) AS title,
         headline,
         summary,
         COALESCE(source, publisher, provider, 'News') AS source,
         publisher,
         provider,
         url,
         COALESCE(published_date::timestamp, created_at) AS published_at,
         sentiment,
         catalyst_type,
         sector,
         news_score,
         source_type,
         created_at
       FROM news_articles
       WHERE published_at IS NULL
         AND published_date >= $1::date
       ORDER BY published_date DESC
       LIMIT $2`,
      [cutoffIso, remainingAfterPublishedAt],
      {
        timeoutMs: 5000,
        label: 'experience.news.snapshot.published_date',
        maxRetries: 1,
      }
    ).catch(() => ({ rows: [] }));

    rows.push(...(publishedDateResult.rows || []));
  }

  const remainingAfterPublishedDate = Math.max(0, limit - rows.length);
  if (remainingAfterPublishedDate > 0) {
    const createdAtResult = await queryWithTimeout(
      `SELECT
         id,
         UPPER(COALESCE(symbol, '')) AS symbol,
         COALESCE(symbols, ARRAY[]::text[]) AS symbols,
         COALESCE(title, headline) AS title,
         headline,
         summary,
         COALESCE(source, publisher, provider, 'News') AS source,
         publisher,
         provider,
         url,
         created_at AS published_at,
         sentiment,
         catalyst_type,
         sector,
         news_score,
         source_type,
         created_at
       FROM news_articles
       WHERE published_at IS NULL
         AND published_date IS NULL
         AND created_at >= $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [cutoffIso, remainingAfterPublishedDate],
      {
        timeoutMs: 4000,
        label: 'experience.news.snapshot.created_at',
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] }));

    rows.push(...(createdAtResult.rows || []));
  }

  return rows;
}

async function loadDirectSymbolNewsRows(symbol, limit) {
  const result = await queryWithTimeout(
    `SELECT
       id,
       UPPER(COALESCE(symbol, '')) AS symbol,
       COALESCE(symbols, ARRAY[]::text[]) AS symbols,
       COALESCE(title, headline) AS title,
       headline,
       summary,
       COALESCE(source, publisher, provider, 'News') AS source,
       publisher,
       provider,
       url,
       COALESCE(published_at, published_date::timestamp, created_at) AS published_at,
       sentiment,
       catalyst_type,
       sector,
       news_score,
       source_type,
       created_at
     FROM news_articles
     WHERE UPPER(COALESCE(symbol, '')) = $1
        OR $1 = ANY(COALESCE(symbols, ARRAY[]::text[]))
     ORDER BY published_at DESC NULLS LAST, published_date DESC NULLS LAST, created_at DESC
     LIMIT $2`,
    [symbol, limit],
    {
      timeoutMs: 5000,
      label: 'experience.news.symbol_direct',
      maxRetries: 0,
    }
  ).catch(() => ({ rows: [] }));

  return (result.rows || []).map((row) => normalizeNewsArticle(row)).filter(Boolean);
}

function filterNewsRows(rows, { cutoffHours, search, symbol, typeFilter }) {
  const cutoffTs = Date.now() - (cutoffHours * 60 * 60 * 1000);
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();

  return rows.filter((row) => {
    const publishedTs = row.published_at ? Date.parse(row.published_at) : 0;
    if (publishedTs < cutoffTs) {
      return false;
    }

    if (normalizedSymbol) {
      const symbols = Array.isArray(row.symbols) ? row.symbols : [];
      if (!symbols.includes(normalizedSymbol) && String(row.symbol || '').trim().toUpperCase() !== normalizedSymbol) {
        return false;
      }
    }

    if (normalizedSearch) {
      const haystack = [
        row.symbol,
        ...(Array.isArray(row.symbols) ? row.symbols : []),
        row.title,
        row.headline,
        row.summary,
        row.source,
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
      if (!haystack.includes(normalizedSearch)) {
        return false;
      }
    }

    if (typeFilter === 'market') {
      return row.type === 'macro';
    }
    if (typeFilter === 'stocks') {
      return row.type !== 'macro';
    }
    return true;
  });
}

async function buildNewsSnapshot() {
  const cutoffIso = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString();
  const resultRows = await loadNewsSnapshotRows(cutoffIso, NEWS_SNAPSHOT_LIMIT);

  const rows = dedupeNewsRows(resultRows
    .map((row) => normalizeNewsArticle(row))
    .filter(Boolean))
    .sort((left, right) => Date.parse(String(right.published_at || 0)) - Date.parse(String(left.published_at || 0)));

  const snapshot = {
    created_at: new Date().toISOString(),
    data: rows,
  };

  setCache(NEWS_SNAPSHOT_KEY, snapshot, NEWS_SNAPSHOT_TTL_MS * 3);
  return snapshot;
}

async function refreshNewsSnapshot() {
  if (newsRefreshPromise) {
    return newsRefreshPromise;
  }

  newsRefreshPromise = buildNewsSnapshot()
    .catch((error) => {
      const cached = getCache(NEWS_SNAPSHOT_KEY);
      if (cached?.data) {
        return cached;
      }
      throw error;
    })
    .finally(() => {
      newsRefreshPromise = null;
    });

  return newsRefreshPromise;
}

async function getNewsSnapshot() {
  const cached = getCache(NEWS_SNAPSHOT_KEY);
  if (cached?.data) {
    void refreshNewsSnapshot().catch(() => {});
    return cached;
  }

  return refreshNewsSnapshot();
}

async function getCachedNewsFeedPayload(options = {}) {
  const snapshot = await getNewsSnapshot();
  const limit = clamp(Number(options.limit) || 50, 1, 200);
  const page = Math.max(1, Number(options.page) || 1);
  const offset = Math.max(0, Number(options.offset) || ((page - 1) * limit));
  const cutoffHours = parseWindowToHours(options.window || options.time);
  const search = String(options.search || options.q || '').trim();
  const symbol = String(options.filterSymbol || options.filter_symbol || '').trim().toUpperCase();
  const type = String(options.type || 'all').trim().toLowerCase();
  const baseRows = filterNewsRows(snapshot.data || [], {
    cutoffHours,
    search,
    symbol,
    typeFilter: 'all',
  });
  const filteredRows = filterNewsRows(baseRows, {
    cutoffHours,
    search,
    symbol,
    typeFilter: type,
  });
  const data = filteredRows.slice(offset, offset + limit);
  const counts = {
    all: baseRows.length,
    market: baseRows.filter((row) => row.type === 'macro').length,
    stocks: baseRows.filter((row) => row.type !== 'macro').length,
  };

  return {
    success: true,
    count: data.length,
    total_count: filteredRows.length,
    counts,
    limit,
    offset,
    page,
    type,
    filterSymbol: symbol,
    search,
    window: options.window || options.time || '24h',
    data,
    raw_articles: data,
    articles: data,
    themes: [],
    snapshot_at: snapshot.created_at,
    source: 'snapshot',
  };
}

async function getCachedSymbolNewsPayload(symbolInput, limitInput) {
  const symbol = normalizeSymbol(symbolInput);
  const limit = clamp(Number(limitInput) || 5, 1, 20);
  const snapshot = await getNewsSnapshot();
  const snapshotRows = (snapshot.data || [])
    .filter((row) => {
      const symbols = Array.isArray(row.symbols) ? row.symbols : [];
      return row.symbol === symbol || symbols.includes(symbol);
    })
    .slice(0, limit);

  const fallbackRows = snapshotRows.length >= limit
    ? []
    : await loadDirectSymbolNewsRows(symbol, limit);

  const directRows = dedupeNewsRows([...snapshotRows, ...fallbackRows]).slice(0, limit);

  return {
    success: true,
    symbol,
    status: directRows.length > 0 ? 'ok' : 'no_data',
    count: directRows.length,
    direct_count: directRows.length,
    fallback_applied: false,
    context_source: directRows.length > 0 ? 'DIRECT' : 'NONE',
    data: directRows,
    articles: directRows,
    coverage: {
      direct: directRows.length,
      total: directRows.length,
    },
    message: directRows.length === 0 ? 'No symbol-specific news available.' : null,
    snapshot_at: snapshot.created_at,
    source: 'snapshot',
  };
}

async function buildEarningsSnapshot() {
  const result = await queryWithTimeout(
    `SELECT
       e.symbol,
       COALESCE(e.company, tu.company_name) AS company_name,
       e.report_date::text AS report_date,
       COALESCE(NULLIF(e.report_time, ''), NULLIF(e.time, ''), 'TBD') AS time,
       e.eps_estimate,
       e.eps_actual,
       COALESCE(e.revenue_estimate, e.rev_estimate) AS revenue_estimate,
       COALESCE(e.revenue_actual, e.rev_actual) AS revenue_actual,
       e.expected_move_percent,
       e.market_cap,
       COALESCE(e.sector, tu.sector) AS sector,
       tu.industry,
       e.score,
       COALESCE(e.updated_at, e.created_at, NOW()) AS updated_at,
       COALESCE(e.source, 'db') AS source
     FROM earnings_events e
     LEFT JOIN ticker_universe tu ON UPPER(e.symbol) = UPPER(tu.symbol)
     WHERE e.report_date::date BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE + INTERVAL '45 days'
     ORDER BY e.report_date ASC, e.symbol ASC
     LIMIT $1`,
    [EARNINGS_SNAPSHOT_LIMIT],
    {
      timeoutMs: 6000,
      label: 'experience.earnings.snapshot',
      maxRetries: 1,
    }
  );

  const rows = (result.rows || []).map((row) => normalizeEarningsRow(row)).filter(Boolean);
  const snapshot = {
    created_at: new Date().toISOString(),
    data: rows,
  };

  setCache(EARNINGS_SNAPSHOT_KEY, snapshot, EARNINGS_SNAPSHOT_TTL_MS * 3);
  return snapshot;
}

async function refreshEarningsSnapshot() {
  if (earningsRefreshPromise) {
    return earningsRefreshPromise;
  }

  earningsRefreshPromise = buildEarningsSnapshot().finally(() => {
    earningsRefreshPromise = null;
  });

  return earningsRefreshPromise;
}

async function getEarningsSnapshot() {
  const cached = getCache(EARNINGS_SNAPSHOT_KEY);
  if (cached?.data) {
    void refreshEarningsSnapshot().catch(() => {});
    return cached;
  }

  return refreshEarningsSnapshot();
}

async function getCachedEarningsCalendarPayload(options = {}) {
  const snapshot = await getEarningsSnapshot();
  const from = String(options.from || options.startDate || '').trim() || new Date().toISOString().slice(0, 10);
  const to = String(options.to || options.endDate || '').trim() || new Date(Date.now() + (7 * 86400000)).toISOString().slice(0, 10);
  const limit = clamp(Number(options.limit) || 100, 1, 600);
  const classFilter = String(options.class || '').trim().toUpperCase();
  let rows = (snapshot.data || []).filter((row) => row.report_date >= from && row.report_date <= to);

  if (classFilter) {
    rows = rows.filter((row) => String(row.trade_class || '').trim().toUpperCase() === classFilter);
  }

  const data = rows.slice(0, limit);
  return {
    success: true,
    mode: 'requested_window',
    window_start: from,
    window_end: to,
    count: data.length,
    status: data.length ? 'partial' : 'none',
    source: 'snapshot',
    data,
    rows: data,
    events: data,
    message: data.length ? '' : 'No earnings data available',
    snapshot_at: snapshot.created_at,
  };
}

async function buildFastResearchSnapshot(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  const cacheKey = `experience:research:fast:${symbol}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return cached;
  }

  const startedAt = Date.now();
  const base = emptyResearchData(symbol);
  const screenerPayload = getCachedScreenerPayload();
  const screenerRows = Array.isArray(screenerPayload?.data) ? screenerPayload.data : [];
  const screenerRow = screenerRows.find((row) => String(row?.symbol || '').trim().toUpperCase() === symbol) || null;
  const supplementsPromise = loadFastResearchSupplements(symbol).catch(() => ({
    company: {},
    next: null,
    history: [],
    warnings: ['research_supplement_unavailable'],
  }));

  if (screenerRow) {
    const supplements = await supplementsPromise;
    const warnings = Array.isArray(supplements.warnings) ? supplements.warnings : [];
    const fastData = {
      ...base,
      market: {
        price: screenerRow.price ?? null,
        change_percent: screenerRow.change_percent ?? null,
        volume: screenerRow.volume ?? null,
        market_cap: screenerRow.market_cap ?? null,
        relative_volume: screenerRow.rvol ?? screenerRow.relative_volume ?? null,
        updated_at: screenerRow.updated_at || null,
      },
      technicals: {
        atr: screenerRow.atr ?? null,
        rsi: screenerRow.rsi ?? null,
        vwap: screenerRow.vwap ?? null,
        relative_volume: screenerRow.rvol ?? screenerRow.relative_volume ?? null,
        avg_volume_30d: screenerRow.avg_volume_30d ?? null,
      },
      company: {
        company_name: supplements.company.company_name || screenerRow.company_name || screenerRow.name || symbol,
        sector: supplements.company.sector || screenerRow.sector || null,
        industry: supplements.company.industry || screenerRow.industry || null,
        exchange: supplements.company.exchange || screenerRow.exchange || null,
        country: supplements.company.country || null,
        website: supplements.company.website || null,
        description: supplements.company.description || null,
      },
      earnings: {
        latest: supplements.history[0] || null,
        next: supplements.next || (screenerRow.earnings_date ? {
          symbol,
          report_date: screenerRow.earnings_date,
          report_time: null,
          eps_estimate: null,
          eps_actual: null,
          revenue_estimate: null,
          revenue_actual: null,
          market_cap: screenerRow.market_cap ?? null,
          sector: screenerRow.sector || null,
          industry: screenerRow.industry || null,
        } : null),
        history: supplements.history,
      },
      screener: screenerRow,
      news_count: screenerRow.has_news ? 1 : 0,
      data_confidence: Number(screenerRow.data_confidence || 0),
      data_confidence_label: screenerRow.data_confidence_label || 'LOW',
      data_quality_label: screenerRow.data_quality_label || screenerRow.data_confidence_label || 'LOW',
      warnings,
    };

    fastData.mcp = buildMCP(fastData);

    const snapshotPayload = {
      data: fastData,
      meta: {
        response_ms: Date.now() - startedAt,
        fallback: false,
        reason: null,
        phase: 'fast',
        source: 'snapshot',
        warnings,
      },
      snapshot_at: screenerPayload?.snapshot_at || null,
    };

    setCache(cacheKey, snapshotPayload, RESEARCH_FAST_TTL_MS);
    return snapshotPayload;
  }

  const [profileResult, marketResult, nextResult, historyResult, newsCountResult] = await Promise.all([
    queryWithTimeout(
      `SELECT company_name, exchange, sector, industry
       FROM ticker_universe
       WHERE UPPER(symbol) = $1
       LIMIT 1`,
      [symbol],
      {
        timeoutMs: 4000,
        label: 'experience.research.profile',
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT
         q.price,
         q.volume,
         q.market_cap,
         q.relative_volume,
         q.updated_at,
         m.atr,
         m.rsi,
         m.vwap,
         m.avg_volume_30d
       FROM market_quotes q
       LEFT JOIN market_metrics m ON m.symbol = q.symbol
       WHERE q.symbol = $1
       ORDER BY q.updated_at DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      {
        timeoutMs: 4000,
        label: 'experience.research.market',
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT
         symbol,
         report_date::text AS report_date,
         COALESCE(NULLIF(report_time, ''), NULLIF(time, ''), 'TBD') AS report_time,
         eps_estimate,
         COALESCE(revenue_estimate, rev_estimate) AS revenue_estimate,
         market_cap,
         sector,
         industry
       FROM earnings_events
       WHERE UPPER(symbol) = $1
         AND report_date >= CURRENT_DATE
       ORDER BY report_date ASC
       LIMIT 1`,
      [symbol],
      {
        timeoutMs: 4000,
        label: 'experience.research.next_earnings',
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT
         report_date::text AS report_date,
         COALESCE(NULLIF(report_time, ''), 'TBD') AS report_time,
         eps_estimate,
         eps_actual,
         revenue_estimate,
         revenue_actual
       FROM earnings_history
       WHERE UPPER(symbol) = $1
       ORDER BY report_date DESC
       LIMIT 4`,
      [symbol],
      {
        timeoutMs: 4000,
        label: 'experience.research.history',
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT COUNT(*)::int AS cnt
       FROM news_articles
       WHERE (
         UPPER(COALESCE(symbol, '')) = $1
         OR (
           COALESCE(symbol, '') = ''
           AND EXISTS (
             SELECT 1
             FROM unnest(COALESCE(symbols, ARRAY[]::text[])) AS symbol_ref(symbol)
             WHERE UPPER(symbol_ref.symbol) = $1
           )
         )
       )
         AND COALESCE(published_at, published_date, created_at) >= NOW() - INTERVAL '7 days'`,
      [symbol],
      {
        timeoutMs: 4000,
        label: 'experience.research.news_count',
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [{ cnt: 0 }] })),
  ]);

  const profile = profileResult.rows?.[0] || {};
  const market = marketResult.rows?.[0] || {};
  const nextEarnings = nextResult.rows?.[0] || null;
  const history = (historyResult.rows || []).map((row) => ({
    report_date: row.report_date || null,
    report_time: row.report_time || null,
    eps_estimate: Number.isFinite(Number(row.eps_estimate)) ? Number(row.eps_estimate) : null,
    eps_actual: Number.isFinite(Number(row.eps_actual)) ? Number(row.eps_actual) : null,
    revenue_estimate: Number.isFinite(Number(row.revenue_estimate)) ? Number(row.revenue_estimate) : null,
    revenue_actual: Number.isFinite(Number(row.revenue_actual)) ? Number(row.revenue_actual) : null,
  }));

  const nextData = {
    ...base,
    market: {
      price: screenerRow?.price ?? market.price ?? null,
      change_percent: screenerRow?.change_percent ?? null,
      volume: screenerRow?.volume ?? market.volume ?? null,
      market_cap: screenerRow?.market_cap ?? market.market_cap ?? null,
      relative_volume: screenerRow?.rvol ?? screenerRow?.relative_volume ?? market.relative_volume ?? null,
      updated_at: screenerRow?.updated_at || market.updated_at || null,
    },
    technicals: {
      atr: screenerRow?.atr ?? market.atr ?? null,
      rsi: screenerRow?.rsi ?? market.rsi ?? null,
      vwap: screenerRow?.vwap ?? market.vwap ?? null,
      relative_volume: screenerRow?.rvol ?? screenerRow?.relative_volume ?? market.relative_volume ?? null,
      avg_volume_30d: screenerRow?.avg_volume_30d ?? market.avg_volume_30d ?? null,
    },
    company: {
      company_name: screenerRow?.company_name || profile.company_name || symbol,
      sector: screenerRow?.sector || profile.sector || null,
      industry: screenerRow?.industry || profile.industry || null,
      exchange: screenerRow?.exchange || profile.exchange || null,
      country: null,
      website: null,
      description: null,
    },
    earnings: {
      latest: history[0] || null,
      next: nextEarnings ? {
        symbol,
        report_date: nextEarnings.report_date || screenerRow?.earnings_date || null,
        report_time: nextEarnings.report_time || null,
        eps_estimate: Number.isFinite(Number(nextEarnings.eps_estimate)) ? Number(nextEarnings.eps_estimate) : null,
        eps_actual: null,
        revenue_estimate: Number.isFinite(Number(nextEarnings.revenue_estimate)) ? Number(nextEarnings.revenue_estimate) : null,
        revenue_actual: null,
        market_cap: Number.isFinite(Number(nextEarnings.market_cap)) ? Number(nextEarnings.market_cap) : (screenerRow?.market_cap ?? null),
        sector: nextEarnings.sector || screenerRow?.sector || profile.sector || null,
        industry: nextEarnings.industry || screenerRow?.industry || profile.industry || null,
      } : (screenerRow?.earnings_date ? {
        symbol,
        report_date: screenerRow.earnings_date,
        report_time: null,
        eps_estimate: null,
        eps_actual: null,
        revenue_estimate: null,
        revenue_actual: null,
        market_cap: screenerRow.market_cap ?? null,
        sector: screenerRow.sector || profile.sector || null,
        industry: screenerRow.industry || profile.industry || null,
      } : null),
      history,
    },
    screener: screenerRow,
    news_count: Number(newsCountResult.rows?.[0]?.cnt || 0),
    data_confidence: Number(screenerRow?.data_confidence || 0),
    data_confidence_label: screenerRow?.data_confidence_label || 'LOW',
    data_quality_label: screenerRow?.data_quality_label || screenerRow?.data_confidence_label || 'LOW',
  };

  nextData.mcp = buildMCP(nextData);
  const payload = {
    data: nextData,
    meta: {
      response_ms: Date.now() - startedAt,
      fallback: false,
      reason: null,
      phase: 'fast',
      source: screenerRow ? 'snapshot' : 'db',
    },
    snapshot_at: screenerPayload?.snapshot_at || null,
  };

  setCache(cacheKey, payload, RESEARCH_FAST_TTL_MS);
  return payload;
}

function scheduleRecurringRefresh(callback, intervalMs) {
  const timer = setInterval(() => {
    void callback().catch(() => {});
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return timer;
}

function startNewsSnapshotScheduler() {
  if (newsSchedulerStarted) {
    return;
  }

  newsSchedulerStarted = true;
  void refreshNewsSnapshot().catch(() => {});
  scheduleRecurringRefresh(refreshNewsSnapshot, NEWS_SNAPSHOT_TTL_MS);
  console.log('[EXPERIENCE_SNAPSHOTS] news scheduler active (60s)');
}

function startEarningsSnapshotScheduler() {
  if (earningsSchedulerStarted) {
    return;
  }

  earningsSchedulerStarted = true;
  void refreshEarningsSnapshot().catch(() => {});
  scheduleRecurringRefresh(refreshEarningsSnapshot, EARNINGS_SNAPSHOT_TTL_MS);
  console.log('[EXPERIENCE_SNAPSHOTS] earnings scheduler active (60s)');
}

function startExperienceSnapshotSchedulers() {
  startNewsSnapshotScheduler();
  startEarningsSnapshotScheduler();
}

module.exports = {
  buildFastResearchSnapshot,
  getCachedEarningsCalendarPayload,
  getCachedNewsFeedPayload,
  getCachedSymbolNewsPayload,
  startEarningsSnapshotScheduler,
  startExperienceSnapshotSchedulers,
  startNewsSnapshotScheduler,
};