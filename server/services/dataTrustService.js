const { queryWithTimeout } = require('../db/pg');
const { getCoverageStatusesBySymbols } = require('./dataCoverageStatusService');
const { getCoverageSnapshotsBySymbols } = require('./dataCoverageService');
const {
  classifyDailyFreshness,
  classifyIntradayFreshness,
  classifyNewsFreshness,
  getPreviousTradingDay,
  getRelativeTimeLabel,
} = require('../utils/dataFreshness');

const ACTIVE_UNIVERSE_COLUMN_CANDIDATES = ['is_active', 'active'];
let tickerUniverseColumnsPromise = null;

async function getTickerUniverseColumns() {
  if (!tickerUniverseColumnsPromise) {
    tickerUniverseColumnsPromise = queryWithTimeout(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'ticker_universe'`,
      [],
      {
        label: 'data_trust.ticker_universe.columns',
        timeoutMs: 10000,
        maxRetries: 0,
      }
    )
      .then((result) => new Set((result.rows || []).map((row) => String(row.column_name || '').toLowerCase())))
      .catch((error) => {
        tickerUniverseColumnsPromise = null;
        throw error;
      });
  }

  return tickerUniverseColumnsPromise;
}

async function getActiveUniverseFilterClause() {
  const columns = await getTickerUniverseColumns().catch(() => null);
  if (!columns) {
    return '';
  }

  const activeColumn = ACTIVE_UNIVERSE_COLUMN_CANDIDATES.find((column) => columns.has(column));

  if (!activeColumn) {
    return '';
  }

  return `WHERE COALESCE(${activeColumn}, false) = true`;
}

function buildTrustSnapshot(symbol, rows = {}) {
  const coverageStatus = String(rows.coverageStatus || '').trim().toUpperCase() || null;
  const latestMetricPriceRow = rows.latestMetricPriceRow || null;
  const latestQuotePriceRow = rows.latestQuotePriceRow || null;
  const latestDailyRow = rows.latestDailyRow || null;
  const latestNewsRow = rows.latestNewsRow || null;
  const latestEarningsRow = rows.latestEarningsRow || null;
  const newsCount7d = Number(rows.newsCount7d || 0);
  const earningsCount = Number(rows.earningsCount || 0);
  const latestPriceRow = latestMetricPriceRow || latestQuotePriceRow || null;
  const priceTimestamp = latestPriceRow?.updated_at || latestPriceRow?.last_updated || latestDailyRow?.date || null;
  const priceValue = latestPriceRow?.price ?? latestQuotePriceRow?.price ?? latestDailyRow?.close ?? null;
  const dailyDate = latestDailyRow?.date || null;
  const newsTimestamp = latestNewsRow?.published_at || null;
  const earningsDate = latestEarningsRow?.report_date || null;
  const priceFreshness = classifyIntradayFreshness(priceTimestamp);
  const dailyFreshness = classifyDailyFreshness(dailyDate);
  const newsFreshness = classifyNewsFreshness(newsTimestamp);
  const hasPrice = priceValue !== null && priceValue !== undefined;
  const hasDaily = Boolean(dailyFreshness.is_valid);
  const hasNews = newsCount7d >= 3;
  const hasEarnings = earningsCount > 0;
  let isTrustworthy = hasPrice && hasDaily && (hasNews || hasEarnings);
  let trustLevel = isTrustworthy
    ? 'COMPLETE'
    : (hasPrice && hasDaily ? 'SUFFICIENT' : 'LIMITED');

  if (coverageStatus === 'HAS_DATA') {
    isTrustworthy = true;
    trustLevel = 'COMPLETE';
  } else if (['PARTIAL_NEWS', 'PARTIAL_EARNINGS', 'NO_NEWS', 'NO_EARNINGS'].includes(coverageStatus)) {
    trustLevel = hasPrice && hasDaily ? 'SUFFICIENT' : 'LIMITED';
  } else if (['STRUCTURALLY_UNSUPPORTED', 'LOW_QUALITY_TICKER', 'INACTIVE'].includes(coverageStatus)) {
    isTrustworthy = false;
    trustLevel = 'LIMITED';
  }

  return {
    symbol,
    coverage_status: coverageStatus,
    has_price: hasPrice,
    has_daily: hasDaily,
    has_news: hasNews,
    has_earnings: hasEarnings,
    is_trustworthy: isTrustworthy,
    trust_level: trustLevel,
    price: {
      value: priceValue,
      updated_at: priceTimestamp,
      freshness: priceFreshness.label,
      source_label: latestPriceRow?.price != null ? (priceFreshness.is_live ? 'Live' : 'Last Quote') : 'Last Close',
      last_updated_label: getRelativeTimeLabel(priceTimestamp),
    },
    daily: {
      date: dailyDate,
      freshness: dailyFreshness.label,
      last_updated_label: dailyDate ? getRelativeTimeLabel(dailyDate) : 'unknown',
    },
    news: {
      count_7d: newsCount7d,
      latest_published_at: newsTimestamp,
      freshness: newsFreshness.label,
      last_updated_label: getRelativeTimeLabel(newsTimestamp),
    },
    earnings: {
      count_90d_or_upcoming: earningsCount,
      latest_report_date: earningsDate,
      next_label: earningsDate ? getRelativeTimeLabel(earningsDate) : 'unknown',
    },
  };
}

async function getDataTrustSnapshot(symbol) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!normalizedSymbol) {
    throw new Error('symbol_required');
  }

  const result = await queryWithTimeout(
    `WITH metric_price AS (
       SELECT symbol, price, updated_at, last_updated
       FROM market_metrics
       WHERE symbol = $1
       LIMIT 1
     ),
     quote_price AS (
       SELECT symbol, price, updated_at
       FROM market_quotes
       WHERE symbol = $1
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1
     ),
     latest_daily AS (
       SELECT symbol, date, close
       FROM daily_ohlc
       WHERE symbol = $1
       ORDER BY date DESC
       LIMIT 1
     ),
     news_counts AS (
       SELECT COUNT(*)::int AS count
       FROM news_articles
       WHERE symbol = $1
         AND published_at >= NOW() - INTERVAL '7 days'
     ),
     latest_news AS (
       SELECT symbol, published_at, headline
       FROM news_articles
       WHERE symbol = $1
       ORDER BY published_at DESC
       LIMIT 1
     ),
     earnings_rollup AS (
       SELECT COUNT(*)::int AS count, MAX(report_date) AS latest_report_date
       FROM (
         SELECT report_date
         FROM earnings_events
         WHERE symbol = $1
           AND report_date >= CURRENT_DATE - INTERVAL '90 days'
         UNION ALL
         SELECT report_date
         FROM earnings_history
         WHERE symbol = $1
           AND report_date >= CURRENT_DATE - INTERVAL '90 days'
         UNION ALL
         SELECT report_date
         FROM earnings_events
         WHERE symbol = $1
           AND report_date >= CURRENT_DATE
       ) earnings_source
     )
     SELECT
       mp.symbol AS metric_symbol,
       mp.price AS metric_price,
       mp.updated_at AS metric_updated_at,
       mp.last_updated AS metric_last_updated,
       qp.symbol AS quote_symbol,
       qp.price AS quote_price,
       qp.updated_at AS quote_updated_at,
       d.symbol AS daily_symbol,
       d.date AS daily_date,
       d.close AS daily_close,
       COALESCE(nc.count, 0) AS news_count_7d,
       ln.symbol AS news_symbol,
       ln.published_at AS news_published_at,
       er.count AS earnings_count,
       er.latest_report_date AS earnings_latest_report_date
     FROM (SELECT $1::text AS symbol) seed
     LEFT JOIN metric_price mp ON TRUE
     LEFT JOIN quote_price qp ON TRUE
     LEFT JOIN latest_daily d ON TRUE
     LEFT JOIN news_counts nc ON TRUE
     LEFT JOIN latest_news ln ON TRUE
     LEFT JOIN earnings_rollup er ON TRUE`,
    [normalizedSymbol],
    {
      label: 'data_trust.snapshot',
      timeoutMs: 20000,
      maxRetries: 1,
      retryDelayMs: 300,
    }
  );

  const row = result.rows?.[0] || {};
  const coverageSnapshots = await getCoverageSnapshotsBySymbols([normalizedSymbol], { persist: true }).catch(() => new Map());
  const coverageStatus = coverageSnapshots.get(normalizedSymbol)?.status
    || (await getCoverageStatusesBySymbols([normalizedSymbol]).catch(() => new Map())).get(normalizedSymbol)?.status
    || null;

  return buildTrustSnapshot(normalizedSymbol, {
    coverageStatus,
    latestMetricPriceRow: row.metric_price != null
      ? {
          symbol: row.metric_symbol,
          price: row.metric_price,
          updated_at: row.metric_updated_at,
          last_updated: row.metric_last_updated,
        }
      : null,
    latestQuotePriceRow: row.quote_price != null
      ? {
          symbol: row.quote_symbol,
          price: row.quote_price,
          updated_at: row.quote_updated_at,
        }
      : null,
    latestDailyRow: row.daily_close != null || row.daily_date != null
      ? {
          symbol: row.daily_symbol,
          date: row.daily_date,
          close: row.daily_close,
        }
      : null,
    newsCount7d: row.news_count_7d || 0,
    latestNewsRow: row.news_published_at
      ? {
          symbol: row.news_symbol,
          published_at: row.news_published_at,
        }
      : null,
    earningsCount: row.earnings_count || 0,
    latestEarningsRow: row.earnings_latest_report_date
      ? {
          report_date: row.earnings_latest_report_date,
        }
      : null,
  });
}

async function getDataTrust(symbol) {
  const snapshot = await getDataTrustSnapshot(symbol);
  return {
    has_price: snapshot.has_price,
    has_daily: snapshot.has_daily,
    has_news: snapshot.has_news,
    has_earnings: snapshot.has_earnings,
    is_trustworthy: snapshot.is_trustworthy,
    trust_level: snapshot.trust_level,
  };
}

async function getTrustedSymbols(symbols = []) {
  const normalizedSymbols = Array.from(new Set((symbols || [])
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter(Boolean)));

  if (normalizedSymbols.length === 0) {
    return new Set();
  }

  const previousTradingDay = getPreviousTradingDay(new Date()).toISOString().slice(0, 10);
  const result = await queryWithTimeout(
    `WITH input_symbols AS (
       SELECT UNNEST($1::text[]) AS symbol
     ),
     price_symbols AS (
       SELECT DISTINCT symbol FROM market_metrics WHERE symbol = ANY($1::text[]) AND price IS NOT NULL
       UNION
       SELECT DISTINCT symbol FROM market_quotes WHERE symbol = ANY($1::text[]) AND price IS NOT NULL
       UNION
       SELECT DISTINCT symbol FROM daily_ohlc WHERE symbol = ANY($1::text[]) AND close IS NOT NULL
     ),
     daily_symbols AS (
       SELECT DISTINCT symbol
       FROM daily_ohlc
       WHERE symbol = ANY($1::text[])
         AND date::date >= $2::date
     ),
     news_symbols AS (
       SELECT symbol
       FROM news_articles
       WHERE symbol = ANY($1::text[])
         AND published_at >= NOW() - INTERVAL '7 days'
       GROUP BY symbol
       HAVING COUNT(*) >= 3
     ),
     earnings_symbols AS (
       SELECT symbol
       FROM (
         SELECT symbol, report_date
         FROM earnings_events
         WHERE symbol = ANY($1::text[])
           AND report_date >= CURRENT_DATE - INTERVAL '90 days'
         UNION ALL
         SELECT symbol, report_date
         FROM earnings_history
         WHERE symbol = ANY($1::text[])
           AND report_date >= CURRENT_DATE - INTERVAL '90 days'
       ) earnings_source
       GROUP BY symbol
       HAVING COUNT(*) > 0
     )
    SELECT i.symbol
    FROM input_symbols i
    JOIN price_symbols p ON p.symbol = i.symbol
    JOIN daily_symbols d ON d.symbol = i.symbol
    LEFT JOIN news_symbols n ON n.symbol = i.symbol
    LEFT JOIN earnings_symbols e ON e.symbol = i.symbol
    WHERE n.symbol IS NOT NULL OR e.symbol IS NOT NULL`,
    [normalizedSymbols, previousTradingDay],
    {
      label: 'data_trust.trusted_symbols',
      timeoutMs: 20000,
      maxRetries: 0,
    }
  );

  return new Set((result.rows || []).map((row) => String(row.symbol || '').toUpperCase()));
}

async function getDataTrustBySymbols(symbols = []) {
  const normalizedSymbols = Array.from(new Set((symbols || [])
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter(Boolean)));

  if (normalizedSymbols.length === 0) {
    return new Map();
  }

  const [metricPriceResult, quotePriceResult, dailyResult, newsCountResult, latestNewsResult, earningsCountResult, latestEarningsResult] = await Promise.all([
    queryWithTimeout(
      `SELECT DISTINCT ON (symbol) symbol, price, updated_at, last_updated
       FROM market_metrics
       WHERE symbol = ANY($1::text[])
       ORDER BY symbol, COALESCE(updated_at, last_updated) DESC NULLS LAST`,
      [normalizedSymbols],
      {
        label: 'data_trust.market_metrics.batch',
        timeoutMs: 20000,
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT DISTINCT ON (symbol) symbol, price, updated_at
       FROM market_quotes
       WHERE symbol = ANY($1::text[])
       ORDER BY symbol, updated_at DESC NULLS LAST`,
      [normalizedSymbols],
      {
        label: 'data_trust.market_quotes.batch',
        timeoutMs: 20000,
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT DISTINCT ON (symbol) symbol, date, close
       FROM daily_ohlc
       WHERE symbol = ANY($1::text[])
       ORDER BY symbol, date DESC`,
      [normalizedSymbols],
      {
        label: 'data_trust.daily_ohlc.batch',
        timeoutMs: 20000,
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT symbol, COUNT(*)::int AS count
       FROM news_articles
       WHERE symbol = ANY($1::text[])
         AND published_at >= NOW() - INTERVAL '7 days'
       GROUP BY symbol`,
      [normalizedSymbols],
      {
        label: 'data_trust.news.count_7d.batch',
        timeoutMs: 20000,
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT DISTINCT ON (symbol) symbol, published_at, headline
       FROM news_articles
       WHERE symbol = ANY($1::text[])
       ORDER BY symbol, published_at DESC`,
      [normalizedSymbols],
      {
        label: 'data_trust.news.latest.batch',
        timeoutMs: 20000,
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT symbol, COUNT(*)::int AS count
       FROM (
         SELECT symbol, report_date
         FROM earnings_events
         WHERE symbol = ANY($1::text[])
           AND report_date >= CURRENT_DATE - INTERVAL '90 days'
         UNION ALL
         SELECT symbol, report_date
         FROM earnings_history
         WHERE symbol = ANY($1::text[])
           AND report_date >= CURRENT_DATE - INTERVAL '90 days'
       ) earnings_source
       GROUP BY symbol`,
      [normalizedSymbols],
      {
        label: 'data_trust.earnings.count.batch',
        timeoutMs: 20000,
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT DISTINCT ON (symbol) symbol, report_date
       FROM (
         SELECT symbol, report_date
         FROM earnings_events
         WHERE symbol = ANY($1::text[])
         UNION ALL
         SELECT symbol, report_date
         FROM earnings_history
         WHERE symbol = ANY($1::text[])
       ) earnings_source
       ORDER BY symbol, report_date DESC`,
      [normalizedSymbols],
      {
        label: 'data_trust.earnings.latest.batch',
        timeoutMs: 20000,
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
  ]);

  const metricPriceBySymbol = new Map((metricPriceResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
  const quotePriceBySymbol = new Map((quotePriceResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
  const dailyBySymbol = new Map((dailyResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
  const newsCountBySymbol = new Map((newsCountResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), Number(row.count || 0)]));
  const latestNewsBySymbol = new Map((latestNewsResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
  const earningsCountBySymbol = new Map((earningsCountResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), Number(row.count || 0)]));
  const latestEarningsBySymbol = new Map((latestEarningsResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
  const coverageSnapshots = await getCoverageSnapshotsBySymbols(normalizedSymbols, { persist: true }).catch(() => new Map());
  const coverageStatuses = coverageSnapshots.size > 0
    ? coverageSnapshots
    : await getCoverageStatusesBySymbols(normalizedSymbols).catch(() => new Map());

  return new Map(normalizedSymbols.map((symbol) => [
    symbol,
    buildTrustSnapshot(symbol, {
      coverageStatus: coverageStatuses.get(symbol)?.status || null,
      latestMetricPriceRow: metricPriceBySymbol.get(symbol) || null,
      latestQuotePriceRow: quotePriceBySymbol.get(symbol) || null,
      latestDailyRow: dailyBySymbol.get(symbol) || null,
      newsCount7d: newsCountBySymbol.get(symbol) || 0,
      latestNewsRow: latestNewsBySymbol.get(symbol) || null,
      earningsCount: earningsCountBySymbol.get(symbol) || 0,
      latestEarningsRow: latestEarningsBySymbol.get(symbol) || null,
    }),
  ]));
}

async function getGlobalDataTrustHealth() {
  const activeUniverseWhereClause = await getActiveUniverseFilterClause();
  const universeResult = await queryWithTimeout(
    `SELECT symbol
     FROM ticker_universe
     ${activeUniverseWhereClause}`,
    [],
    {
      label: 'data_trust.global_health.universe',
      timeoutMs: 15000,
      maxRetries: 1,
      retryDelayMs: 300,
    }
  );

  const universeSymbols = (universeResult.rows || [])
    .map((row) => String(row.symbol || '').trim().toUpperCase())
    .filter(Boolean);

  const total = universeSymbols.length;
  if (total === 0) {
    return {
      total_tickers: 0,
      fully_trusted_tickers: 0,
      partial_data_tickers: 0,
      missing_data_tickers: 0,
      percent_full_trust: 0,
      percent_missing_news: 0,
      percent_missing_earnings: 0,
    };
  }

  const coverageStatuses = await getCoverageSnapshotsBySymbols(universeSymbols, { persist: true }).catch(() => new Map());
  if (coverageStatuses.size > 0) {
    let trusted = 0;
    let sufficient = 0;
    let limited = 0;
    let missingNews = 0;
    let missingEarnings = 0;

    for (const symbol of universeSymbols) {
      const status = String(coverageStatuses.get(symbol)?.status || '').toUpperCase();

      if (status === 'HAS_DATA') {
        trusted += 1;
      } else if (['PARTIAL_NEWS', 'PARTIAL_EARNINGS', 'NO_NEWS', 'NO_EARNINGS'].includes(status)) {
        sufficient += 1;
      } else {
        limited += 1;
      }

      if (['NO_NEWS', 'LOW_QUALITY_TICKER', 'STRUCTURALLY_UNSUPPORTED', 'INACTIVE'].includes(status)) {
        missingNews += 1;
      }
      if (['NO_EARNINGS', 'STRUCTURALLY_UNSUPPORTED', 'LOW_QUALITY_TICKER', 'INACTIVE'].includes(status)) {
        missingEarnings += 1;
      }
    }

    const partial = total - trusted;
    return {
      total_tickers: total,
      fully_trusted_tickers: trusted,
      partial_data_tickers: partial,
      missing_data_tickers: total - trusted,
      complete_coverage_tickers: trusted,
      sufficient_coverage_tickers: sufficient,
      limited_coverage_tickers: limited,
      percent_full_trust: total > 0 ? Number(((trusted / total) * 100).toFixed(2)) : 0,
      percent_complete_coverage: total > 0 ? Number(((trusted / total) * 100).toFixed(2)) : 0,
      percent_sufficient_coverage: total > 0 ? Number(((sufficient / total) * 100).toFixed(2)) : 0,
      percent_limited_coverage: total > 0 ? Number(((limited / total) * 100).toFixed(2)) : 0,
      percent_missing_news: total > 0 ? Number(((missingNews / total) * 100).toFixed(2)) : 0,
      percent_missing_earnings: total > 0 ? Number(((missingEarnings / total) * 100).toFixed(2)) : 0,
    };
  }

  const previousTradingDay = getPreviousTradingDay(new Date()).toISOString().slice(0, 10);

  const [priceResult, dailyResult, newsResult, earningsResult] = await Promise.all([
    queryWithTimeout(
      `SELECT DISTINCT symbol
       FROM market_metrics
       WHERE price IS NOT NULL
       UNION
       SELECT DISTINCT symbol
       FROM market_quotes
       WHERE price IS NOT NULL
       UNION
       SELECT DISTINCT symbol
       FROM daily_ohlc
       WHERE close IS NOT NULL`,
      [],
      {
        label: 'data_trust.global_health.price_symbols',
        timeoutMs: 30000,
        maxRetries: 1,
        retryDelayMs: 300,
      }
    ),
    queryWithTimeout(
      `SELECT DISTINCT symbol
       FROM daily_ohlc
       WHERE date::date >= $1::date`,
      [previousTradingDay],
      {
        label: 'data_trust.global_health.daily_symbols',
        timeoutMs: 30000,
        maxRetries: 1,
        retryDelayMs: 300,
      }
    ),
    queryWithTimeout(
      `SELECT symbol
       FROM news_articles
       WHERE published_at >= NOW() - INTERVAL '7 days'
       GROUP BY symbol
       HAVING COUNT(*) >= 3`,
      [],
      {
        label: 'data_trust.global_health.news_symbols',
        timeoutMs: 30000,
        maxRetries: 1,
        retryDelayMs: 300,
      }
    ),
    queryWithTimeout(
      `SELECT symbol
       FROM (
         SELECT symbol, report_date
         FROM earnings_events
         WHERE report_date >= CURRENT_DATE - INTERVAL '90 days'
         UNION ALL
         SELECT symbol, report_date
         FROM earnings_history
         WHERE report_date >= CURRENT_DATE - INTERVAL '90 days'
       ) earnings_source
       GROUP BY symbol
       HAVING COUNT(*) > 0`,
      [],
      {
        label: 'data_trust.global_health.earnings_symbols',
        timeoutMs: 30000,
        maxRetries: 1,
        retryDelayMs: 300,
      }
    ),
  ]);

  const universeSet = new Set(universeSymbols);
  const priceSet = new Set((priceResult.rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter((symbol) => universeSet.has(symbol)));
  const dailySet = new Set((dailyResult.rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter((symbol) => universeSet.has(symbol)));
  const newsSet = new Set((newsResult.rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter((symbol) => universeSet.has(symbol)));
  const earningsSet = new Set((earningsResult.rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter((symbol) => universeSet.has(symbol)));

  let trusted = 0;
  let sufficient = 0;
  let limited = 0;
  let missingNews = 0;
  let missingEarnings = 0;

  for (const symbol of universeSet) {
    const hasPrice = priceSet.has(symbol);
    const hasDaily = dailySet.has(symbol);
    const hasNews = newsSet.has(symbol);
    const hasEarnings = earningsSet.has(symbol);

    if (hasPrice && hasDaily && (hasNews || hasEarnings)) {
      trusted += 1;
    } else if (hasPrice && hasDaily) {
      sufficient += 1;
    } else {
      limited += 1;
    }
    if (!hasNews) {
      missingNews += 1;
    }
    if (!hasEarnings) {
      missingEarnings += 1;
    }
  }

  const partial = total - trusted;
  return {
    total_tickers: total,
    fully_trusted_tickers: trusted,
    partial_data_tickers: partial,
    missing_data_tickers: total - trusted,
    complete_coverage_tickers: trusted,
    sufficient_coverage_tickers: sufficient,
    limited_coverage_tickers: limited,
    percent_full_trust: total > 0 ? Number(((trusted / total) * 100).toFixed(2)) : 0,
    percent_complete_coverage: total > 0 ? Number(((trusted / total) * 100).toFixed(2)) : 0,
    percent_sufficient_coverage: total > 0 ? Number(((sufficient / total) * 100).toFixed(2)) : 0,
    percent_limited_coverage: total > 0 ? Number(((limited / total) * 100).toFixed(2)) : 0,
    percent_missing_news: total > 0 ? Number(((missingNews / total) * 100).toFixed(2)) : 0,
    percent_missing_earnings: total > 0 ? Number(((missingEarnings / total) * 100).toFixed(2)) : 0,
  };
}

module.exports = {
  getDataTrust,
  getDataTrustSnapshot,
  getDataTrustBySymbols,
  getTrustedSymbols,
  getGlobalDataTrustHealth,
};