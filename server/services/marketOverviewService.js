const { queryWithTimeout } = require('../db/pg');

const REQUIRED_TABLES = [
  'news_articles',
  'earnings_events',
  'market_metrics',
  'market_quotes',
];

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

async function getAvailableTables() {
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

  return new Set((result.rows || []).map((row) => String(row.table_name || '')));
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

async function getToday(existingTables) {
  const today = {
    earnings: [],
    macro: [],
  };

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

    today.earnings = (earningsResult.rows || []).map((row) => ({
      symbol: row.symbol || null,
      time: row.time || null,
      estimated_eps: row.estimated_eps ?? null,
      estimated_revenue: row.estimated_revenue ?? null,
    }));
  }

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

    today.macro = (macroResult.rows || []).map((row) => ({
      title: row.title || null,
      source: row.source || null,
      published_at: row.published_at || null,
      symbols: Array.isArray(row.symbols) ? row.symbols : [],
      sentiment: row.sentiment || null,
    }));
  }

  return today;
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

async function getMarketOverview() {
  const overview = emptyOverview();
  try {
    const existingTables = await getAvailableTables();

    const [overnight, today, earningsWeek, macroWeek, themes, watchlist] = await Promise.all([
      getOvernight(existingTables),
      getToday(existingTables),
      getEarningsWeek(existingTables),
      getMacroWeek(existingTables),
      getThemes(existingTables),
      getWatchlist(existingTables),
    ]);

    overview.overnight = overnight;
    overview.today = today;
    overview.earnings_week = earningsWeek;
    overview.macro_week = macroWeek;
    overview.themes = themes;
    overview.watchlist = watchlist;
  } catch (error) {
    overview.degraded = true;
    overview.error = String(error?.message || 'market overview unavailable');
  }

  return overview;
}

module.exports = {
  emptyOverview,
  getMarketOverview,
  REQUIRED_TABLES,
};