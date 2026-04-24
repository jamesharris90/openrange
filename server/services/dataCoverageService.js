const { queryWithTimeout } = require('../db/pg');
const { runNewsIngestion } = require('../ingestion/fmp_news_ingest');
const { runEarningsIngestionEngine } = require('../engines/earningsIngestionEngine');
const {
  ensureCoverageStatusTable,
  upsertCoverageStatuses,
} = require('./dataCoverageStatusService');

const FULL_NEWS_THRESHOLD = Math.max(1, Number(process.env.COVERAGE_FULL_NEWS_THRESHOLD) || 3);
const LOW_QUALITY_PRICE_THRESHOLD = Math.max(0.01, Number(process.env.COVERAGE_LOW_QUALITY_PRICE_THRESHOLD) || 1);
const LOW_QUALITY_VOLUME_THRESHOLD = Math.max(1, Number(process.env.COVERAGE_LOW_QUALITY_VOLUME_THRESHOLD) || 100000);
const ACTIVE_UNIVERSE_CACHE_TTL_MS = 5 * 60 * 1000;

let tickerUniverseColumnsPromise = null;
let activeUniverseSymbolsCache = null;

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

async function getTickerUniverseColumns() {
  if (!tickerUniverseColumnsPromise) {
    tickerUniverseColumnsPromise = queryWithTimeout(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'ticker_universe'`,
      [],
      {
        label: 'coverage_service.ticker_universe.columns',
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

function pickTickerUniverseColumn(columns, columnName, fallbackSql = 'NULL') {
  return columns.has(columnName) ? `tu.${columnName}` : fallbackSql;
}

function deriveInstrumentType(context = {}) {
  const companyName = String(context.company_name || '').toLowerCase();
  const industry = String(context.industry || '').toLowerCase();
  const sector = String(context.sector || '').toLowerCase();
  const exchange = String(context.exchange || '').toLowerCase();
  const combined = `${companyName} ${industry} ${sector} ${exchange}`;

  if (/\b(reit|real estate investment trust)\b/.test(combined)) {
    return 'REIT';
  }

  if (/\b(etf|exchange traded fund|exchange-traded fund|index fund)\b/.test(combined)) {
    return 'ETF';
  }

  if (/\b(closed-end fund|closed end fund|fund|trust|unit)\b/.test(combined)) {
    return 'FUND';
  }

  if (/\b(adr|ads|depositary receipt)\b/.test(combined)) {
    return 'ADR';
  }

  return 'STOCK';
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toPositiveNumber(value) {
  const numeric = toNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function hasStructuralEarningsGap(context) {
  const instrumentType = deriveInstrumentType(context);
  const exchange = String(context.exchange || '').trim().toUpperCase();

  if (instrumentType === 'ETF' || instrumentType === 'FUND' || instrumentType === 'REIT') {
    return true;
  }

  if (exchange.startsWith('OTC')) {
    return true;
  }

  return false;
}

function buildCoverageExplanation(status, context) {
  switch (status) {
    case 'HAS_DATA':
      return {
        detail: 'Full coverage',
        explanation: 'Core market coverage is available for this ticker, with usable price data plus at least one recent catalyst source.'
      };
    case 'PARTIAL_NEWS':
      return {
        detail: 'Limited news coverage',
        explanation: 'Limited news coverage detected. Market data and earnings are present, but media activity is light.'
      };
    case 'PARTIAL_EARNINGS':
      return {
        detail: 'Partial earnings coverage',
        explanation: context.next_report_date
          ? 'Upcoming earnings are available, but the historical earnings record is still incomplete.'
          : 'Historical earnings are available, but a fully populated upcoming earnings event is not available yet.'
      };
    case 'NO_NEWS':
      return {
        detail: 'No recent news',
        explanation: 'No recent news coverage was found for this ticker. Market and earnings data are still available.'
      };
    case 'NO_EARNINGS':
      return {
        detail: 'No earnings data available',
        explanation: context.news_count_30d > 0
          ? 'No earnings data is available after fallback checks, but the ticker still has market and news coverage.'
          : 'No earnings data is available after fallback checks, and recent news coverage is also light.'
      };
    case 'STRUCTURALLY_UNSUPPORTED':
      return {
        detail: 'Structurally unsupported',
        explanation: 'No earnings data is available for this listing type, which is structurally less likely to report standard earnings events.'
      };
    case 'LOW_QUALITY_TICKER':
      return {
        detail: 'Low market activity',
        explanation: 'Ticker has low market activity, thin liquidity, and no recent news or earnings coverage.'
      };
    case 'INACTIVE':
    default:
      return {
        detail: 'Inactive',
        explanation: 'Ticker is not currently active in the tracked universe.'
      };
  }
}

function classifyCoverageContext(context) {
  const price = toPositiveNumber(context.price);
  const currentVolume = toPositiveNumber(context.current_volume);
  const avgVolume = toPositiveNumber(context.avg_volume);
  const effectiveVolume = currentVolume ?? avgVolume;
  const newsCount7d = Number(context.news_count_7d || 0);
  const newsCount30d = Number(context.news_count_30d || 0);
  const earningsUpcomingCount = Number(context.earnings_upcoming_count || 0);
  const earningsHistoryCount = Number(context.earnings_history_count || 0);
  const hasAnyNews = newsCount30d > 0;
  const fullNews = newsCount7d >= FULL_NEWS_THRESHOLD;
  const partialNews = !fullNews && hasAnyNews;
  const hasUpcomingEarnings = earningsUpcomingCount > 0;
  const hasHistoricalEarnings = earningsHistoryCount > 0;
  const hasAnyEarnings = hasUpcomingEarnings || hasHistoricalEarnings;
  const fullEarnings = hasUpcomingEarnings && hasHistoricalEarnings;
  const partialEarnings = !fullEarnings && (hasUpcomingEarnings || hasHistoricalEarnings || Boolean(context.latest_report_date) || Boolean(context.next_report_date));
  const hasCoreCoverage = price !== null && (hasAnyNews || hasAnyEarnings);
  const lowQuality = Boolean(
    ((price !== null && price < LOW_QUALITY_PRICE_THRESHOLD) || (effectiveVolume !== null && effectiveVolume < LOW_QUALITY_VOLUME_THRESHOLD))
    && !hasAnyNews
    && !partialEarnings
  );

  let status = 'NO_EARNINGS';

  if (context.is_active === false) {
    status = 'INACTIVE';
  } else if (lowQuality) {
    status = 'LOW_QUALITY_TICKER';
  } else if (hasCoreCoverage) {
    status = 'HAS_DATA';
  } else if (hasStructuralEarningsGap(context) && !partialEarnings) {
    status = 'STRUCTURALLY_UNSUPPORTED';
  } else if (!hasAnyNews && fullEarnings) {
    status = 'NO_NEWS';
  } else if (!partialEarnings) {
    status = 'NO_EARNINGS';
  } else if (!fullNews && partialEarnings && partialNews) {
    status = 'PARTIAL_EARNINGS';
  } else if (partialEarnings) {
    status = 'PARTIAL_EARNINGS';
  } else if (partialNews) {
    status = 'PARTIAL_NEWS';
  } else if (!hasAnyNews) {
    status = 'NO_NEWS';
  }

  const explanation = buildCoverageExplanation(status, {
    ...context,
    price,
    current_volume: currentVolume,
    avg_volume: avgVolume,
    news_count_7d: newsCount7d,
    news_count_30d: newsCount30d,
  });

  return {
    symbol: context.symbol,
    status,
    detail: explanation.detail,
    explanation: explanation.explanation,
    metrics: {
      price,
      current_volume: currentVolume,
      avg_volume: avgVolume,
      news_count_7d: newsCount7d,
      news_count_30d: newsCount30d,
      earnings_upcoming_count: earningsUpcomingCount,
      earnings_history_count: earningsHistoryCount,
      latest_report_date: context.latest_report_date || null,
      next_report_date: context.next_report_date || null,
    },
    flags: {
      has_full_news: fullNews,
      has_partial_news: partialNews,
      has_full_earnings: fullEarnings,
      has_partial_earnings: partialEarnings,
      low_quality: lowQuality,
      structurally_unsupported: status === 'STRUCTURALLY_UNSUPPORTED',
    },
  };
}

async function loadCoverageContexts(symbols) {
  const normalizedSymbols = Array.from(new Set((symbols || []).map(normalizeSymbol).filter(Boolean)));
  if (!normalizedSymbols.length) {
    return [];
  }

  const tickerUniverseColumns = await getTickerUniverseColumns();
  const activeSql = tickerUniverseColumns.has('is_active')
    ? 'COALESCE(tu.is_active, true)'
    : tickerUniverseColumns.has('active')
      ? 'COALESCE(tu.active, true)'
      : 'true';

  const result = await queryWithTimeout(
    `WITH input_symbols AS (
       SELECT UNNEST($1::text[]) AS symbol
     ),
     news_rollup AS (
       SELECT
         symbol,
         COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '7 days')::int AS news_count_7d,
         COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '30 days')::int AS news_count_30d,
         MAX(published_at) AS latest_news_at
       FROM news_articles
       WHERE symbol = ANY($1::text[])
       GROUP BY symbol
     ),
     earnings_rollup AS (
       SELECT
         symbol,
         COUNT(*) FILTER (WHERE source_type = 'upcoming' AND report_date >= CURRENT_DATE AND report_date <= CURRENT_DATE + INTERVAL '180 days')::int AS earnings_upcoming_count,
         COUNT(*) FILTER (WHERE source_type = 'history' AND report_date >= CURRENT_DATE - INTERVAL '365 days')::int AS earnings_history_count,
         MAX(report_date) FILTER (WHERE source_type = 'history') AS latest_report_date,
         MIN(report_date) FILTER (WHERE source_type = 'upcoming' AND report_date >= CURRENT_DATE) AS next_report_date
       FROM (
         SELECT symbol, report_date, 'upcoming'::text AS source_type
         FROM earnings_events
         WHERE symbol = ANY($1::text[])
         UNION ALL
         SELECT symbol, report_date, 'history'::text AS source_type
         FROM earnings_history
         WHERE symbol = ANY($1::text[])
       ) earnings_source
       GROUP BY symbol
     )
     SELECT
       s.symbol,
       ${activeSql} AS is_active,
       COALESCE((to_jsonb(mq)->>'price')::numeric, (to_jsonb(mm)->>'price')::numeric, ${pickTickerUniverseColumn(tickerUniverseColumns, 'price', 'NULL::numeric')}) AS price,
       COALESCE((to_jsonb(mm)->>'current_volume')::numeric, (to_jsonb(mm)->>'volume')::numeric, (to_jsonb(mq)->>'volume')::numeric, ${pickTickerUniverseColumn(tickerUniverseColumns, 'volume', 'NULL::numeric')}) AS current_volume,
       COALESCE((to_jsonb(mm)->>'avg_volume')::numeric, (to_jsonb(mm)->>'average_volume')::numeric, ${pickTickerUniverseColumn(tickerUniverseColumns, 'avg_volume', pickTickerUniverseColumn(tickerUniverseColumns, 'volume', 'NULL::numeric'))}) AS avg_volume,
       COALESCE(cp.company_name, ${pickTickerUniverseColumn(tickerUniverseColumns, 'company_name', 'NULL::text')}) AS company_name,
       COALESCE(cp.sector, ${pickTickerUniverseColumn(tickerUniverseColumns, 'sector', 'NULL::text')}) AS sector,
       COALESCE(cp.industry, ${pickTickerUniverseColumn(tickerUniverseColumns, 'industry', 'NULL::text')}) AS industry,
       COALESCE(cp.exchange, ${pickTickerUniverseColumn(tickerUniverseColumns, 'exchange', 'NULL::text')}) AS exchange,
       COALESCE(cp.country, ${pickTickerUniverseColumn(tickerUniverseColumns, 'country', 'NULL::text')}) AS country,
       COALESCE(nr.news_count_7d, 0) AS news_count_7d,
       COALESCE(nr.news_count_30d, 0) AS news_count_30d,
       nr.latest_news_at,
       COALESCE(er.earnings_upcoming_count, 0) AS earnings_upcoming_count,
       COALESCE(er.earnings_history_count, 0) AS earnings_history_count,
       er.latest_report_date,
       er.next_report_date
     FROM input_symbols s
     LEFT JOIN ticker_universe tu ON UPPER(tu.symbol) = s.symbol
     LEFT JOIN company_profiles cp ON UPPER(cp.symbol) = s.symbol
     LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = s.symbol
     LEFT JOIN market_quotes mq ON UPPER(mq.symbol) = s.symbol
     LEFT JOIN news_rollup nr ON nr.symbol = s.symbol
     LEFT JOIN earnings_rollup er ON er.symbol = s.symbol`,
    [normalizedSymbols],
    {
      label: 'coverage_service.contexts',
      timeoutMs: 30000,
      maxRetries: 0,
    }
  );

  return result.rows || [];
}

async function getCoverageContext(symbol) {
  const contexts = await loadCoverageContexts([symbol]);
  return contexts[0] || null;
}

async function computeCoverageSnapshots(symbols, options = {}) {
  const contexts = await loadCoverageContexts(symbols);
  const snapshots = contexts.map((context) => classifyCoverageContext(context));

  if (options.persist !== false && snapshots.length) {
    await ensureCoverageStatusTable();
    await upsertCoverageStatuses(snapshots.map((snapshot) => ({
      symbol: snapshot.symbol,
      status: snapshot.status,
      last_checked: new Date().toISOString(),
    })));
  }

  return snapshots;
}

async function getCoverageSnapshotsBySymbols(symbols, options = {}) {
  const normalizedSymbols = Array.from(new Set((symbols || []).map(normalizeSymbol).filter(Boolean)));
  if (!normalizedSymbols.length) {
    return new Map();
  }

  let snapshots = await computeCoverageSnapshots(normalizedSymbols, {
    persist: options.persist !== false,
  });

  if (options.attemptEnrichment) {
    const missingNewsSymbols = snapshots
      .filter((snapshot) => ['LOW_QUALITY_TICKER', 'NO_NEWS', 'NO_EARNINGS', 'PARTIAL_NEWS', 'PARTIAL_EARNINGS'].includes(snapshot.status) && Number(snapshot.metrics.news_count_30d || 0) === 0)
      .map((snapshot) => snapshot.symbol);
    const missingEarningsSymbols = snapshots
      .filter((snapshot) => ['NO_EARNINGS', 'STRUCTURALLY_UNSUPPORTED', 'LOW_QUALITY_TICKER', 'PARTIAL_EARNINGS'].includes(snapshot.status) && Number(snapshot.metrics.earnings_upcoming_count || 0) === 0 && Number(snapshot.metrics.earnings_history_count || 0) === 0)
      .map((snapshot) => snapshot.symbol);

    if (missingNewsSymbols.length) {
      await runNewsIngestion(missingNewsSymbols, { maxArticlesPerSymbol: 20 }).catch(() => null);
    }

    if (missingEarningsSymbols.length) {
      await runEarningsIngestionEngine({ symbols: missingEarningsSymbols }).catch(() => null);
    }

    if (missingNewsSymbols.length || missingEarningsSymbols.length) {
      snapshots = await computeCoverageSnapshots(normalizedSymbols, { persist: options.persist !== false });
    }
  }

  return new Map(snapshots.map((snapshot) => [snapshot.symbol, snapshot]));
}

async function getCoverageExplanation(symbol) {
  const snapshots = await getCoverageSnapshotsBySymbols([symbol], { persist: true });
  return snapshots.get(normalizeSymbol(symbol)) || null;
}

async function getActiveUniverseSymbols() {
  if (activeUniverseSymbolsCache && (Date.now() - activeUniverseSymbolsCache.timestamp) < ACTIVE_UNIVERSE_CACHE_TTL_MS) {
    return activeUniverseSymbolsCache.symbols;
  }

  const tickerUniverseColumns = await getTickerUniverseColumns();
  const whereClause = tickerUniverseColumns.has('is_active')
    ? 'WHERE COALESCE(is_active, true) = true'
    : tickerUniverseColumns.has('active')
      ? 'WHERE COALESCE(active, true) = true'
      : '';

  const result = await queryWithTimeout(
    `SELECT UPPER(TRIM(symbol)) AS symbol
     FROM ticker_universe
     ${whereClause}`,
    [],
    {
      label: 'coverage_service.active_universe',
      timeoutMs: 20000,
      maxRetries: 0,
    }
  );

  const symbols = (result.rows || []).map((row) => normalizeSymbol(row.symbol)).filter(Boolean);
  activeUniverseSymbolsCache = {
    symbols,
    timestamp: Date.now(),
  };

  return symbols;
}

async function getGlobalCoverageHealth() {
  const symbols = await getActiveUniverseSymbols();
  const snapshots = Array.from((await getCoverageSnapshotsBySymbols(symbols, { persist: true })).values());
  const total = snapshots.length;
  const full = snapshots.filter((snapshot) => snapshot.status === 'HAS_DATA').length;
  const partial = snapshots.filter((snapshot) => ['PARTIAL_NEWS', 'PARTIAL_EARNINGS', 'NO_NEWS', 'NO_EARNINGS'].includes(snapshot.status)).length;
  const unsupported = snapshots.filter((snapshot) => snapshot.status === 'STRUCTURALLY_UNSUPPORTED').length;
  const lowQuality = snapshots.filter((snapshot) => snapshot.status === 'LOW_QUALITY_TICKER').length;

  return {
    ok: true,
    total_tickers: total,
    full_coverage_tickers: full,
    partial_coverage_tickers: partial,
    unsupported_coverage_tickers: unsupported,
    low_quality_tickers: lowQuality,
    percent_full_coverage: total > 0 ? Number(((full / total) * 100).toFixed(2)) : 0,
    percent_partial_coverage: total > 0 ? Number(((partial / total) * 100).toFixed(2)) : 0,
    percent_unsupported_coverage: total > 0 ? Number(((unsupported / total) * 100).toFixed(2)) : 0,
    percent_low_quality: total > 0 ? Number(((lowQuality / total) * 100).toFixed(2)) : 0,
    breakdown: snapshots.reduce((accumulator, snapshot) => {
      const key = snapshot.status;
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {}),
  };
}

async function refreshCoverageUniverse(options = {}) {
  const symbols = Array.isArray(options.symbols) && options.symbols.length
    ? Array.from(new Set(options.symbols.map(normalizeSymbol).filter(Boolean)))
    : await getActiveUniverseSymbols();

  const before = await getCoverageSnapshotsBySymbols(symbols, { persist: true });
  const after = await getCoverageSnapshotsBySymbols(symbols, {
    persist: true,
    attemptEnrichment: true,
  });

  return {
    symbols_requested: symbols.length,
    before: Array.from(before.values()),
    after: Array.from(after.values()),
  };
}

module.exports = {
  FULL_NEWS_THRESHOLD,
  LOW_QUALITY_PRICE_THRESHOLD,
  LOW_QUALITY_VOLUME_THRESHOLD,
  classifyCoverageContext,
  computeCoverageSnapshots,
  getCoverageSnapshotsBySymbols,
  getCoverageContext,
  getCoverageExplanation,
  getGlobalCoverageHealth,
  getActiveUniverseSymbols,
  hasStructuralEarningsGap,
  loadCoverageContexts,
  refreshCoverageUniverse,
};