const { queryWithTimeout } = require('../db/pg');

const REQUIRED_TABLES = [
  'news_articles',
  'earnings_events',
  'market_metrics',
  'market_quotes',
];

const SECTION_TIMEOUT_MS = {
  overnight: 2500,
  today_earnings: 2500,
  today_macro: 2500,
  earnings_week: 2500,
  macro_week: 3000,
  themes: 3000,
  watchlist: 2500,
};

const TABLE_CACHE_TTL_MS = 5 * 60 * 1000;
const OVERVIEW_CACHE_TTL_MS = 60 * 1000;

let availableTablesCache = {
  expiresAt: 0,
  tables: null,
};

let overviewCache = {
  expiresAt: 0,
  cachedAt: null,
  data: null,
};

let overviewRefreshPromise = null;

function emptyOverview() {
  return {
    overnight: { headlines: [] },
    today: {
      earnings: [],
      macro: [],
    },
    earnings_week: [],
    macro_week: { headlines: [] },
    themes: [],
    watchlist: [],
  };
}

function cloneOverview(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function decorateOverviewCacheMeta(overview, cacheMeta = {}) {
  const cloned = cloneOverview(overview);
  cloned.meta = {
    ...(cloned.meta || {}),
    cache: {
      hit: Boolean(cacheMeta.hit),
      stale: Boolean(cacheMeta.stale),
      cached_at: cacheMeta.cachedAt || null,
    },
  };

  if (cacheMeta.refreshError) {
    cloned.meta.refresh_error = cacheMeta.refreshError;
  }

  return cloned;
}

function createSectionTimeoutError(sectionName, timeoutMs) {
  const error = new Error(`Market overview section timeout after ${timeoutMs}ms (${sectionName})`);
  error.code = 'SECTION_TIMEOUT';
  return error;
}

function withDeadline(promiseFactory, timeoutMs, sectionName) {
  return Promise.race([
    Promise.resolve().then(promiseFactory),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(createSectionTimeoutError(sectionName, timeoutMs)), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

async function loadOverviewSection(sectionName, promiseFactory, fallbackValue, timeoutMs) {
  const startedAt = Date.now();

  try {
    const value = await withDeadline(promiseFactory, timeoutMs, sectionName);
    return {
      section: sectionName,
      ok: true,
      timedOut: false,
      error: null,
      duration_ms: Date.now() - startedAt,
      value,
    };
  } catch (error) {
    return {
      section: sectionName,
      ok: false,
      timedOut: error?.code === 'SECTION_TIMEOUT',
      error: error?.message || 'section_failed',
      duration_ms: Date.now() - startedAt,
      value: fallbackValue,
    };
  }
}

async function getAvailableTables() {
  if (availableTablesCache.tables && availableTablesCache.expiresAt > Date.now()) {
    return new Set(availableTablesCache.tables);
  }

  const result = await queryWithTimeout(
    `SELECT c.relname AS table_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname = ANY($1::text[])`,
    [REQUIRED_TABLES],
    {
      timeoutMs: 8000,
      label: 'market_overview.tables',
      maxRetries: 1,
      retryDelayMs: 250,
    }
  );

  const tables = (result.rows || []).map((row) => String(row.table_name || ''));
  availableTablesCache = {
    expiresAt: Date.now() + TABLE_CACHE_TTL_MS,
    tables,
  };

  return new Set(tables);
}

async function getOvernight(existingTables) {
  if (!existingTables.has('news_articles')) {
    return { headlines: [] };
  }

  const result = await queryWithTimeout(
    `SELECT
       COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(headline), '')) AS title,
       source,
       published_at,
       symbols,
       sentiment
     FROM news_articles
     WHERE published_at >= NOW() - INTERVAL '12 hours'
     ORDER BY published_at DESC
     LIMIT 20`,
    [],
    {
      timeoutMs: 5000,
      label: 'market_overview.overnight',
      maxRetries: 0,
    }
  );

  return {
    headlines: (result.rows || []).map((row) => ({
      title: row.title || null,
      source: row.source || null,
      published_at: row.published_at || null,
      symbols: Array.isArray(row.symbols) ? row.symbols : [],
      sentiment: row.sentiment || null,
    })),
  };
}

async function getTodayEarnings(existingTables) {
  if (existingTables.has('earnings_events')) {
    const earningsResult = await queryWithTimeout(
      `SELECT
         symbol,
         COALESCE(NULLIF(TRIM(time), ''), NULLIF(TRIM(report_time), '')) AS time,
         eps_estimate AS estimated_eps,
         COALESCE(revenue_estimate, rev_estimate) AS estimated_revenue
       FROM earnings_events
       WHERE COALESCE(report_date, earnings_date) = CURRENT_DATE
       ORDER BY symbol ASC`,
      [],
      {
        timeoutMs: 5000,
        label: 'market_overview.today.earnings',
        maxRetries: 0,
      }
    );

    return (earningsResult.rows || []).map((row) => ({
      symbol: row.symbol || null,
      time: row.time || null,
      estimated_eps: row.estimated_eps ?? null,
      estimated_revenue: row.estimated_revenue ?? null,
    }));
  }

  return [];
}

async function getTodayMacro(existingTables) {
  if (existingTables.has('news_articles')) {
    const macroResult = await queryWithTimeout(
      `SELECT
         COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(headline), '')) AS title,
         source,
         published_at,
         symbols,
         sentiment
       FROM news_articles
       WHERE published_at >= NOW() - INTERVAL '24 hours'
         AND COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(headline), '')) ILIKE ANY($1::text[])
       ORDER BY published_at DESC
       LIMIT 10`,
      [[
        '%CPI%',
        '%inflation%',
        '%fed%',
        '%rates%',
        '%speech%',
        '%senate%',
        '%president%',
      ]],
      {
        timeoutMs: 5000,
        label: 'market_overview.today.macro',
        maxRetries: 0,
      }
    );

    return (macroResult.rows || []).map((row) => ({
      title: row.title || null,
      source: row.source || null,
      published_at: row.published_at || null,
      symbols: Array.isArray(row.symbols) ? row.symbols : [],
      sentiment: row.sentiment || null,
    }));
  }

  return [];
}

async function getEarningsWeek(existingTables) {
  if (!existingTables.has('earnings_events')) {
    return [];
  }

  const result = await queryWithTimeout(
    `SELECT
       symbol,
       COALESCE(report_date, earnings_date) AS event_date,
       COALESCE(NULLIF(TRIM(time), ''), NULLIF(TRIM(report_time), '')) AS time,
       sector
     FROM earnings_events
     WHERE COALESCE(report_date, earnings_date)
       BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
     ORDER BY COALESCE(report_date, earnings_date) ASC, symbol ASC
     LIMIT 50`,
    [],
    {
      timeoutMs: 5000,
      label: 'market_overview.earnings_week',
      maxRetries: 0,
    }
  );

  return (result.rows || []).map((row) => ({
    symbol: row.symbol || null,
    event_date: row.event_date || null,
    time: row.time || null,
    sector: row.sector || null,
  }));
}

async function getMacroWeek(existingTables) {
  if (!existingTables.has('news_articles')) {
    return { headlines: [] };
  }

  const result = await queryWithTimeout(
    `SELECT
       COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(headline), '')) AS title,
       source,
       published_at,
       symbols,
       sentiment
     FROM news_articles
     WHERE published_at >= NOW() - INTERVAL '7 days'
       AND (
         COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(headline), '')) ILIKE '%CPI%'
         OR COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(headline), '')) ILIKE '%Fed%'
         OR COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(headline), '')) ILIKE '%inflation%'
         OR COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(headline), '')) ILIKE '%rates%'
         OR COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(headline), '')) ILIKE '%war%'
         OR COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(headline), '')) ILIKE '%oil%'
         OR COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(headline), '')) ILIKE '%geopolitics%'
       )
     ORDER BY published_at DESC
     LIMIT 20`,
    [],
    {
      timeoutMs: 5000,
      label: 'market_overview.macro_week',
      maxRetries: 0,
    }
  );

  return {
    headlines: (result.rows || []).map((row) => ({
      title: row.title || null,
      source: row.source || null,
      published_at: row.published_at || null,
      symbols: Array.isArray(row.symbols) ? row.symbols : [],
      sentiment: row.sentiment || null,
    })),
  };
}

async function getThemes(existingTables) {
  if (!existingTables.has('market_metrics') || !existingTables.has('market_quotes')) {
    return [];
  }

  try {
    const result = await queryWithTimeout(
      `WITH top_movers AS (
         SELECT
           mm.symbol,
           mm.change_percent,
           mm.relative_volume,
           mq.sector
         FROM market_metrics mm
         LEFT JOIN market_quotes mq
           ON mq.symbol = mm.symbol
         WHERE mm.relative_volume > 2
           AND mm.change_percent IS NOT NULL
         ORDER BY ABS(mm.change_percent) DESC, mm.relative_volume DESC
         LIMIT 10
       )
       SELECT
         sector,
         AVG(change_percent) AS avg_change,
         AVG(relative_volume) AS avg_rvol,
         (ARRAY_REMOVE(ARRAY_AGG(symbol ORDER BY ABS(change_percent) DESC), NULL))[1:5] AS sample_symbols
       FROM top_movers
       WHERE NULLIF(TRIM(sector), '') IS NOT NULL
       GROUP BY sector
       ORDER BY ABS(AVG(change_percent)) DESC, AVG(relative_volume) DESC`,
      [],
      {
        timeoutMs: 12000,
        label: 'market_overview.themes',
        maxRetries: 0,
      }
    );

    return (result.rows || []).map((row) => ({
      sector: row.sector || null,
      avg_change: row.avg_change ?? null,
      avg_rvol: row.avg_rvol ?? null,
      sample_symbols: Array.isArray(row.sample_symbols) ? row.sample_symbols : [],
    }));
  } catch (_error) {
    return [];
  }
}

async function getWatchlist(existingTables) {
  if (!existingTables.has('market_metrics')) {
    return [];
  }

  const result = await queryWithTimeout(
    `SELECT
       symbol,
       price,
       change_percent,
       volume,
       relative_volume
     FROM market_metrics
     WHERE relative_volume > 2
       AND volume > 1000000
     ORDER BY relative_volume DESC, volume DESC
     LIMIT 20`,
    [],
    {
      timeoutMs: 5000,
      label: 'market_overview.watchlist',
      maxRetries: 0,
    }
  );

  return (result.rows || []).map((row) => ({
    symbol: row.symbol || null,
    price: row.price ?? null,
    change_percent: row.change_percent ?? null,
    volume: row.volume ?? null,
    relative_volume: row.relative_volume ?? null,
  }));
}

async function buildMarketOverview() {
  const overview = emptyOverview();

  let existingTables = new Set(REQUIRED_TABLES);
  let tableMetadataError = null;

  try {
    existingTables = await getAvailableTables();
  } catch (error) {
    tableMetadataError = String(error?.message || 'table_metadata_failed');
  }

  const [overnight, todayEarnings, todayMacro, earningsWeek, macroWeek, themes, watchlist] = await Promise.all([
    loadOverviewSection('overnight', () => getOvernight(existingTables), { headlines: [] }, SECTION_TIMEOUT_MS.overnight),
    loadOverviewSection('today_earnings', () => getTodayEarnings(existingTables), [], SECTION_TIMEOUT_MS.today_earnings),
    loadOverviewSection('today_macro', () => getTodayMacro(existingTables), [], SECTION_TIMEOUT_MS.today_macro),
    loadOverviewSection('earnings_week', () => getEarningsWeek(existingTables), [], SECTION_TIMEOUT_MS.earnings_week),
    loadOverviewSection('macro_week', () => getMacroWeek(existingTables), { headlines: [] }, SECTION_TIMEOUT_MS.macro_week),
    loadOverviewSection('themes', () => getThemes(existingTables), [], SECTION_TIMEOUT_MS.themes),
    loadOverviewSection('watchlist', () => getWatchlist(existingTables), [], SECTION_TIMEOUT_MS.watchlist),
  ]);

  overview.overnight = overnight.value;
  overview.today = {
    earnings: todayEarnings.value,
    macro: todayMacro.value,
  };
  overview.earnings_week = earningsWeek.value;
  overview.macro_week = macroWeek.value;
  overview.themes = themes.value;
  overview.watchlist = watchlist.value;

  const sectionResults = [overnight, todayEarnings, todayMacro, earningsWeek, macroWeek, themes, watchlist];
  const degradedSections = sectionResults.filter((section) => !section.ok).map((section) => section.section);

  overview.partial = Boolean(tableMetadataError) || degradedSections.length > 0;
  overview.degraded = degradedSections.length === sectionResults.length;

  overview.meta = {
    table_metadata_error: tableMetadataError,
    degraded_sections: degradedSections,
    section_status: Object.fromEntries(
      sectionResults.map((section) => [
        section.section,
        {
          ok: section.ok,
          timed_out: section.timedOut,
          error: section.error,
          duration_ms: section.duration_ms,
        },
      ])
    ),
  };

  return overview;
}

async function getMarketOverview() {
  const now = Date.now();
  if (overviewCache.data && overviewCache.expiresAt > now) {
    return decorateOverviewCacheMeta(overviewCache.data, {
      hit: true,
      stale: false,
      cachedAt: overviewCache.cachedAt,
    });
  }

  if (overviewRefreshPromise) {
    if (overviewCache.data) {
      return decorateOverviewCacheMeta(overviewCache.data, {
        hit: true,
        stale: true,
        cachedAt: overviewCache.cachedAt,
      });
    }

    return overviewRefreshPromise;
  }

  overviewRefreshPromise = (async () => {
    const overview = await buildMarketOverview();

    if (!overview.degraded) {
      overviewCache = {
        expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS,
        cachedAt: new Date().toISOString(),
        data: cloneOverview(overview),
      };
    }

    if (overview.degraded && overviewCache.data) {
      return decorateOverviewCacheMeta(overviewCache.data, {
        hit: true,
        stale: true,
        cachedAt: overviewCache.cachedAt,
        refreshError: overview?.meta?.degraded_sections?.join(',') || overview?.meta?.table_metadata_error || 'refresh_failed',
      });
    }

    return decorateOverviewCacheMeta(overview, {
      hit: false,
      stale: false,
      cachedAt: overviewCache.cachedAt,
    });
  })().finally(() => {
    overviewRefreshPromise = null;
  });

  return overviewRefreshPromise;
}

module.exports = {
  emptyOverview,
  getMarketOverview,
  REQUIRED_TABLES,
};