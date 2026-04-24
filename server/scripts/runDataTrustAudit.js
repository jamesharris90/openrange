#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const { queryWithTimeout, pool } = require('../db/pg');
const { computeCompletenessConfidence } = require('../services/dataConfidenceService');

const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs');
const REPORT_PATH = path.join(LOG_DIR, 'data_trust_report.json');
const PRECHECK_PATH = path.join(LOG_DIR, 'precheck_validation.json');
const FMP_API_KEY = process.env.FMP_API_KEY || '';
const TODAY = new Date();

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureLogDir();
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function asPercent(part, total) {
  if (!total) {
    return 0;
  }

  return Number(((part / total) * 100).toFixed(2));
}

function pickRandom(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[Math.floor(Math.random() * rows.length)] || null;
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function parseDate(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDateToken(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const text = String(value).trim();
    return text.length >= 10 ? text.slice(0, 10) : null;
  }

  return parsed.toISOString().slice(0, 10);
}

function getPreviousTradingDay(date = new Date()) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  do {
    current.setUTCDate(current.getUTCDate() - 1);
  } while (current.getUTCDay() === 0 || current.getUTCDay() === 6);
  return current;
}

function isPriceStale(timestamp) {
  const parsed = parseDate(timestamp);
  if (parsed === null) {
    return true;
  }

  return (Date.now() - parsed) > (24 * 60 * 60 * 1000);
}

function isDailyStale(dateValue) {
  const parsed = parseDate(dateValue);
  if (parsed === null) {
    return true;
  }

  const previousTradingDay = getPreviousTradingDay(TODAY).getTime();
  return parsed < previousTradingDay;
}

function buildReason(row, field) {
  if (field === 'chart') {
    if (!row.has_intraday_rows && !row.has_daily_rows) {
      return 'no DB rows in intraday_1m or daily_ohlc';
    }

    if (row.has_daily_rows && isDailyStale(row.last_daily_date) && !row.has_intraday_rows) {
      return 'daily chart rows are stale and no intraday backfill exists';
    }

    return 'chart pipeline returned incomplete candle coverage';
  }

  if (field === 'volume') {
    if (!row.has_quote_row && !row.has_metric_row) {
      return 'no DB rows in market_quotes or market_metrics';
    }

    if (row.has_metric_row && !row.has_quote_row) {
      return 'market_metrics row exists but quote pipeline is missing';
    }

    if (row.has_quote_row && isPriceStale(row.quote_updated_at)) {
      return 'quote pipeline is stale';
    }

    return 'volume field is missing on the latest quote payload';
  }

  if (field === 'earnings') {
    if (row.next_earnings_date) {
      return 'upcoming earnings exists';
    }

    if (Number(row.past_earnings_count || 0) > 0) {
      return 'historical earnings exist but no upcoming event is available';
    }

    return 'no DB rows in earnings_events or earnings_history';
  }

  return 'unknown';
}

async function getTableColumns(tableName) {
  const result = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName],
    {
      label: `data_trust.columns.${tableName}`,
      timeoutMs: 10000,
      maxRetries: 0,
    }
  );

  return new Set((result.rows || []).map((row) => String(row.column_name || '').toLowerCase()));
}

async function getTableCount(tableName) {
  const timeoutMs = ['intraday_1m', 'daily_ohlc', 'news_articles'].includes(tableName)
    ? 120000
    : 20000;

  try {
    const result = await queryWithTimeout(
      `SELECT COUNT(*)::bigint AS count FROM ${tableName}`,
      [],
      {
        label: `data_trust.count.${tableName}`,
        timeoutMs,
        maxRetries: 0,
      }
    );

    return Number(result.rows?.[0]?.count || 0);
  } catch (error) {
    if (!String(error?.message || '').includes('statement timeout')) {
      throw error;
    }

    const estimate = await queryWithTimeout(
      `SELECT COALESCE(n_live_tup, 0)::bigint AS count
       FROM pg_stat_all_tables
       WHERE schemaname = 'public' AND relname = $1`,
      [tableName],
      {
        label: `data_trust.count_estimate.${tableName}`,
        timeoutMs: 10000,
        maxRetries: 0,
      }
    );

    const estimatedCount = Number(estimate.rows?.[0]?.count || 0);
    console.warn(`Using estimated row count for ${tableName}: ${estimatedCount}`);
    return estimatedCount;
  }
}

async function runPrecheck() {
  const requiredTables = [
    'ticker_universe',
    'market_quotes',
    'market_metrics',
    'intraday_1m',
    'daily_ohlc',
    'earnings_events',
    'earnings_history',
  ];

  const requiredColumns = {
    ticker_universe: ['symbol'],
    market_quotes: ['symbol', 'price', 'volume', 'updated_at'],
    market_metrics: ['symbol', 'rsi', 'atr', 'vwap'],
    intraday_1m: ['symbol', 'timestamp', 'close'],
    daily_ohlc: ['symbol', 'date', 'close'],
    earnings_events: ['symbol', 'report_date'],
    earnings_history: ['symbol', 'report_date'],
  };

  const tables = [];
  const columns = [];
  const rowCounts = [];
  const columnSets = new Map();

  for (const tableName of requiredTables) {
    const tableColumns = await getTableColumns(tableName);
    columnSets.set(tableName, tableColumns);
    tables.push({ table: tableName, exists: tableColumns.size > 0 });
    rowCounts.push({ table: tableName, count: await getTableCount(tableName) });

    for (const columnName of requiredColumns[tableName]) {
      columns.push({
        table: tableName,
        column: columnName,
        exists: tableColumns.has(columnName),
      });
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    tables,
    columns,
    row_counts: rowCounts,
    ok: tables.every((entry) => entry.exists) && columns.every((entry) => entry.exists),
  };

  writeJson(PRECHECK_PATH, payload);
  return { payload, columnSets };
}

function buildUniverseWhereClause(tickerUniverseColumns) {
  if (tickerUniverseColumns.has('is_active')) {
    return 'WHERE COALESCE(is_active, false) = true';
  }

  if (tickerUniverseColumns.has('active')) {
    return 'WHERE COALESCE(active, false) = true';
  }

  return '';
}

async function loadAuditRows(columnSets) {
  const tickerUniverseColumns = columnSets.get('ticker_universe') || new Set();
  const marketQuoteColumns = columnSets.get('market_quotes') || new Set();
  const marketMetricColumns = columnSets.get('market_metrics') || new Set();
  const universeWhereClause = buildUniverseWhereClause(tickerUniverseColumns);
  const marketCapQuoteExpr = marketQuoteColumns.has('market_cap') ? 'market_cap' : 'NULL::numeric';
  const marketCapMetricExpr = marketMetricColumns.has('market_cap') ? 'market_cap' : 'NULL::numeric';

  const result = await queryWithTimeout(
    `WITH universe AS (
       SELECT UPPER(symbol) AS symbol
       FROM ticker_universe
       ${universeWhereClause}
     ),
     latest_quotes AS (
       SELECT DISTINCT ON (UPPER(symbol))
         UPPER(symbol) AS symbol,
         price,
         volume,
         change_percent,
         relative_volume,
         ${marketCapQuoteExpr} AS market_cap,
         updated_at
       FROM market_quotes
       WHERE UPPER(symbol) IN (SELECT symbol FROM universe)
       ORDER BY UPPER(symbol), updated_at DESC NULLS LAST
     ),
     latest_metrics AS (
       SELECT DISTINCT ON (UPPER(symbol))
         UPPER(symbol) AS symbol,
         price,
         volume,
         ${marketCapMetricExpr} AS market_cap,
         rsi,
         atr,
         vwap,
         updated_at,
         last_updated
       FROM market_metrics
       WHERE UPPER(symbol) IN (SELECT symbol FROM universe)
       ORDER BY UPPER(symbol), COALESCE(updated_at, last_updated) DESC NULLS LAST
     ),
     intraday_rollup AS (
       SELECT UPPER(symbol) AS symbol,
              COUNT(*)::int AS intraday_rows,
              MAX(timestamp) AS last_intraday_at
       FROM intraday_1m
       WHERE UPPER(symbol) IN (SELECT symbol FROM universe)
       GROUP BY UPPER(symbol)
     ),
     daily_rollup AS (
       SELECT UPPER(symbol) AS symbol,
              COUNT(*)::int AS daily_rows,
              MAX(date) AS last_daily_date,
              (ARRAY_AGG(close ORDER BY date DESC))[1] AS last_daily_close
       FROM daily_ohlc
       WHERE UPPER(symbol) IN (SELECT symbol FROM universe)
       GROUP BY UPPER(symbol)
     ),
     next_earnings AS (
       SELECT symbol, report_date
       FROM (
         SELECT UPPER(symbol) AS symbol,
                report_date,
                ROW_NUMBER() OVER (PARTITION BY UPPER(symbol) ORDER BY report_date ASC) AS row_num
         FROM (
           SELECT symbol, report_date
           FROM earnings_events
           WHERE report_date >= CURRENT_DATE
           UNION ALL
           SELECT symbol, report_date
           FROM earnings_history
           WHERE report_date >= CURRENT_DATE
         ) source_rows
         WHERE UPPER(symbol) IN (SELECT symbol FROM universe)
       ) ranked
       WHERE row_num = 1
     ),
     past_earnings AS (
       SELECT UPPER(symbol) AS symbol,
              COUNT(*)::int AS past_earnings_count,
              MAX(report_date) AS latest_past_earnings_date
       FROM (
         SELECT symbol, report_date
         FROM earnings_events
         WHERE report_date < CURRENT_DATE
         UNION ALL
         SELECT symbol, report_date
         FROM earnings_history
         WHERE report_date < CURRENT_DATE
       ) source_rows
       WHERE UPPER(symbol) IN (SELECT symbol FROM universe)
       GROUP BY UPPER(symbol)
     )
     SELECT
       u.symbol,
       lq.symbol IS NOT NULL AS has_quote_row,
       lm.symbol IS NOT NULL AS has_metric_row,
       COALESCE(lq.price, lm.price) AS price,
       COALESCE(lq.volume, lm.volume) AS volume,
       COALESCE(lq.market_cap, lm.market_cap) AS market_cap,
       lq.change_percent,
       lq.relative_volume,
       lm.rsi,
       lm.atr,
       lm.vwap,
       lq.updated_at AS quote_updated_at,
       COALESCE(lm.updated_at, lm.last_updated) AS metric_updated_at,
       COALESCE(ir.intraday_rows, 0) AS intraday_rows,
       ir.last_intraday_at,
       COALESCE(dr.daily_rows, 0) AS daily_rows,
       dr.last_daily_date,
       dr.last_daily_close,
       ne.report_date AS next_earnings_date,
       COALESCE(pe.past_earnings_count, 0) AS past_earnings_count,
       pe.latest_past_earnings_date
     FROM universe u
     LEFT JOIN latest_quotes lq ON lq.symbol = u.symbol
     LEFT JOIN latest_metrics lm ON lm.symbol = u.symbol
     LEFT JOIN intraday_rollup ir ON ir.symbol = u.symbol
     LEFT JOIN daily_rollup dr ON dr.symbol = u.symbol
     LEFT JOIN next_earnings ne ON ne.symbol = u.symbol
     LEFT JOIN past_earnings pe ON pe.symbol = u.symbol
     ORDER BY u.symbol ASC`,
    [],
    {
      label: 'data_trust.audit_rows',
      timeoutMs: 120000,
      maxRetries: 0,
      poolType: 'read',
    }
  );

  return (result.rows || []).map((row) => {
    const normalized = {
      symbol: normalizeSymbol(row.symbol),
      has_quote_row: Boolean(row.has_quote_row),
      has_metric_row: Boolean(row.has_metric_row),
      price: row.price == null ? null : Number(row.price),
      volume: row.volume == null ? null : Number(row.volume),
      market_cap: row.market_cap == null ? null : Number(row.market_cap),
      change_percent: row.change_percent == null ? null : Number(row.change_percent),
      relative_volume: row.relative_volume == null ? null : Number(row.relative_volume),
      rsi: row.rsi == null ? null : Number(row.rsi),
      atr: row.atr == null ? null : Number(row.atr),
      vwap: row.vwap == null ? null : Number(row.vwap),
      quote_updated_at: row.quote_updated_at || null,
      metric_updated_at: row.metric_updated_at || null,
      intraday_rows: Number(row.intraday_rows || 0),
      last_intraday_at: row.last_intraday_at || null,
      daily_rows: Number(row.daily_rows || 0),
      last_daily_date: row.last_daily_date || null,
      last_daily_close: row.last_daily_close == null ? null : Number(row.last_daily_close),
      next_earnings_date: row.next_earnings_date || null,
      past_earnings_count: Number(row.past_earnings_count || 0),
      latest_past_earnings_date: row.latest_past_earnings_date || null,
    };

    const confidencePayload = computeCompletenessConfidence({
      has_price: normalized.price !== null,
      has_volume: normalized.volume !== null,
      has_chart_data: normalized.intraday_rows > 0 || normalized.daily_rows > 0,
      has_technicals: normalized.rsi !== null && normalized.atr !== null && normalized.vwap !== null,
      has_earnings: Boolean(normalized.next_earnings_date),
    });

    return {
      ...normalized,
      has_chart_data: normalized.intraday_rows > 0 || normalized.daily_rows > 0,
      has_technicals: normalized.rsi !== null && normalized.atr !== null && normalized.vwap !== null,
      has_intraday_rows: normalized.intraday_rows > 0,
      has_daily_rows: normalized.daily_rows > 0,
      stale_price: isPriceStale(normalized.quote_updated_at || normalized.metric_updated_at),
      stale_chart: isDailyStale(normalized.last_daily_date) && !normalized.last_intraday_at,
      ...confidencePayload,
    };
  });
}

function summarizeCoverage(rows) {
  const total = rows.length;
  const withPrice = rows.filter((row) => row.price !== null).length;
  const withVolume = rows.filter((row) => row.volume !== null).length;
  const withMarketCap = rows.filter((row) => row.market_cap !== null).length;
  const withChartData = rows.filter((row) => row.has_chart_data).length;
  const withTechnicals = rows.filter((row) => row.has_technicals).length;
  const withEarnings = rows.filter((row) => row.next_earnings_date).length;

  return {
    total_symbols: total,
    with_price_percent: asPercent(withPrice, total),
    with_volume_percent: asPercent(withVolume, total),
    with_market_cap_percent: asPercent(withMarketCap, total),
    with_chart_data_percent: asPercent(withChartData, total),
    with_technicals_percent: asPercent(withTechnicals, total),
    with_earnings_percent: asPercent(withEarnings, total),
  };
}

function topMissing(rows, predicate, reasonField) {
  return rows
    .filter(predicate)
    .sort((left, right) => {
      if (Number(right.market_cap || 0) !== Number(left.market_cap || 0)) {
        return Number(right.market_cap || 0) - Number(left.market_cap || 0);
      }
      if (Number(right.volume || 0) !== Number(left.volume || 0)) {
        return Number(right.volume || 0) - Number(left.volume || 0);
      }
      return String(left.symbol).localeCompare(String(right.symbol));
    })
    .slice(0, 20)
    .map((row) => ({
      symbol: row.symbol,
      market_cap: row.market_cap,
      volume: row.volume,
      next_earnings_date: row.next_earnings_date,
      reason: buildReason(row, reasonField),
    }));
}

function topStale(rows) {
  return rows
    .filter((row) => row.stale_price || row.stale_chart)
    .sort((left, right) => {
      const leftScore = Number(left.stale_price) + Number(left.stale_chart);
      const rightScore = Number(right.stale_price) + Number(right.stale_chart);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return Number(right.market_cap || 0) - Number(left.market_cap || 0);
    })
    .slice(0, 20)
    .map((row) => ({
      symbol: row.symbol,
      stale_price: row.stale_price,
      stale_chart: row.stale_chart,
      quote_updated_at: row.quote_updated_at,
      last_daily_date: row.last_daily_date,
    }));
}

async function fetchYahooQuoteAndChart(symbol) {
  const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, {
    params: {
      interval: '1d',
      range: '1mo',
      includePrePost: 'false',
      events: 'div,splits',
    },
    timeout: 8000,
    validateStatus: () => true,
  });

  if (response.status !== 200) {
    throw new Error(`yahoo_chart_${response.status}`);
  }

  const result = response.data?.chart?.result?.[0] || {};
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
  let latest = null;

  for (let index = closes.length - 1; index >= 0; index -= 1) {
    const close = Number(closes[index]);
    const timestamp = Number(timestamps[index]);
    if (Number.isFinite(close) && Number.isFinite(timestamp)) {
      latest = {
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        close,
      };
      break;
    }
  }

  return {
    price: Number(result.meta?.regularMarketPrice || latest?.close || 0) || null,
    latest,
  };
}

async function fetchFmpUpcomingEarnings(symbol) {
  if (!FMP_API_KEY) {
    return null;
  }

  const from = new Date();
  const to = new Date();
  to.setUTCDate(to.getUTCDate() + 180);
  const response = await axios.get('https://financialmodelingprep.com/stable/earnings-calendar', {
    params: {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      symbol,
      apikey: FMP_API_KEY,
    },
    timeout: 8000,
    validateStatus: () => true,
  });

  if (response.status !== 200) {
    return null;
  }

  const rows = Array.isArray(response.data) ? response.data : [];
  const match = rows.find((row) => normalizeSymbol(row.symbol) === symbol) || null;
  if (!match) {
    return null;
  }

  return String(match.date || match.reportDate || match.report_date || '').slice(0, 10) || null;
}

function isWithinTolerance(left, right, maxPercentDiff = 2) {
  if (!Number.isFinite(Number(left)) || !Number.isFinite(Number(right))) {
    return false;
  }

  const baseline = Math.max(Math.abs(Number(right)), 0.01);
  return (Math.abs(Number(left) - Number(right)) / baseline) * 100 <= maxPercentDiff;
}

function isDateMatch(left, right) {
  const normalizedLeft = normalizeDateToken(left);
  const normalizedRight = normalizeDateToken(right);

  if (!normalizedLeft && !normalizedRight) {
    return true;
  }

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  const leftTime = parseDate(`${normalizedLeft}T00:00:00Z`);
  const rightTime = parseDate(`${normalizedRight}T00:00:00Z`);
  if (leftTime === null || rightTime === null) {
    return false;
  }

  return Math.abs(leftTime - rightTime) <= 24 * 60 * 60 * 1000;
}

async function buildTrustTest(row, category) {
  const [externalChart, externalEarnings] = await Promise.all([
    fetchYahooQuoteAndChart(row.symbol).catch(() => ({ price: null, latest: null })),
    fetchFmpUpcomingEarnings(row.symbol).catch(() => null),
  ]);

  const priceCorrect = isWithinTolerance(row.price, externalChart.price, 2);
  const chartCorrect = isDateMatch(row.last_daily_date, externalChart.latest?.date)
    && isWithinTolerance(row.last_daily_close, externalChart.latest?.close, 2);
  const earningsCorrect = isDateMatch(row.next_earnings_date, externalEarnings);
  const score = Number(priceCorrect) + Number(chartCorrect) + Number(earningsCorrect);

  return {
    category,
    ticker: row.symbol,
    internal_price: row.price,
    external_price: externalChart.price,
    internal_chart_date: normalizeDateToken(row.last_daily_date),
    external_chart_date: externalChart.latest?.date || null,
    internal_earnings_date: row.next_earnings_date,
    external_earnings_date: externalEarnings,
    price_correct: priceCorrect,
    chart_correct: chartCorrect,
    earnings_correct: earningsCorrect,
    overall_trust: score === 3 ? 'HIGH' : score === 2 ? 'MEDIUM' : 'LOW',
  };
}

function pickCategorySamples(rows) {
  const positiveVolumeRows = rows.filter((row) => row.volume !== null && row.price !== null);
  const sortedByMarketCap = [...rows].filter((row) => row.market_cap !== null).sort((left, right) => Number(right.market_cap) - Number(left.market_cap));
  const lowVolumeSorted = [...positiveVolumeRows].sort((left, right) => Number(left.volume) - Number(right.volume));
  const highMomentumSorted = [...rows]
    .filter((row) => row.price !== null && row.has_chart_data)
    .sort((left, right) => Math.abs(Number(right.change_percent || 0)) - Math.abs(Number(left.change_percent || 0)));

  return {
    large_cap: pickRandom(sortedByMarketCap.slice(0, Math.min(200, sortedByMarketCap.length))),
    mid_cap: pickRandom(rows.filter((row) => Number(row.market_cap || 0) >= 2_000_000_000 && Number(row.market_cap || 0) < 10_000_000_000)),
    small_cap: pickRandom(rows.filter((row) => Number(row.market_cap || 0) >= 300_000_000 && Number(row.market_cap || 0) < 2_000_000_000)),
    low_volume: pickRandom(lowVolumeSorted.slice(0, Math.min(200, lowVolumeSorted.length))),
    high_momentum: pickRandom(highMomentumSorted.slice(0, Math.min(100, highMomentumSorted.length))),
  };
}

async function main() {
  const { payload: precheckPayload, columnSets } = await runPrecheck();
  if (!precheckPayload.ok) {
    throw new Error('precheck_failed');
  }

  const rows = await loadAuditRows(columnSets);
  const coverage = summarizeCoverage(rows);
  const weakPoints = {
    missing_chart: topMissing(rows, (row) => !row.has_chart_data, 'chart'),
    missing_volume: topMissing(rows, (row) => row.volume === null, 'volume'),
    missing_earnings: topMissing(rows, (row) => !row.next_earnings_date, 'earnings'),
    stale_data: topStale(rows),
  };

  const samples = pickCategorySamples(rows);
  const trustTests = [];
  for (const [category, row] of Object.entries(samples)) {
    if (row) {
      trustTests.push(await buildTrustTest(row, category));
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    coverage,
    weak_points: weakPoints,
    trust_tests: trustTests,
  };

  writeJson(REPORT_PATH, report);

  console.log(`TOTAL SYMBOLS: ${coverage.total_symbols}`);
  console.log(`WITH PRICE: ${coverage.with_price_percent}%`);
  console.log(`WITH VOLUME: ${coverage.with_volume_percent}%`);
  console.log(`WITH MARKET CAP: ${coverage.with_market_cap_percent}%`);
  console.log(`WITH CHART DATA: ${coverage.with_chart_data_percent}%`);
  console.log(`WITH TECHNICALS: ${coverage.with_technicals_percent}%`);
  console.log(`WITH EARNINGS: ${coverage.with_earnings_percent}%`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });