#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const axios = require('axios');
const csvToJson = require('csvtojson');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const { queryWithTimeout, pool } = require('../db/pg');

const FINVIZ_TOKEN = process.env.FINVIZ_NEWS_TOKEN;
const REPORT_PATH = path.resolve(__dirname, '..', '..', 'reports', 'ticker-field-snapshot-24.csv');
const EXACT_TICKERS = [
  'PLTR', 'SOFI', 'RKLB', 'UPST', 'BB', 'OPEN',
  'DKNG', 'RBLX', 'AFRM', 'NET', 'SNAP', 'COIN',
  'AMD', 'SHOP', 'UBER', 'BA', 'PYPL', 'DIS',
  'AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'META',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/[%,$]/g, '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toTickerMap(rows) {
  const out = new Map();
  for (const row of rows || []) {
    const ticker = String(row.Ticker || row.ticker || row.Symbol || '').trim().toUpperCase();
    if (!ticker) continue;
    out.set(ticker, row);
  }
  return out;
}

async function fetchFinvizView(view) {
  if (!FINVIZ_TOKEN) {
    return new Map();
  }

  const url = 'https://elite.finviz.com/export.ashx';
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await axios.get(url, {
        params: {
          v: String(view),
          t: EXACT_TICKERS.join(','),
          auth: FINVIZ_TOKEN,
        },
        timeout: 20000,
        responseType: 'text',
        validateStatus: () => true,
        headers: {
          'User-Agent': 'Mozilla/5.0 OpenRange CSV Export',
        },
      });

      if (response.status === 429) {
        lastError = new Error(`finviz_rate_limited_view_${view}`);
        await sleep(2500 * attempt);
        continue;
      }

      if (response.status !== 200) {
        throw new Error(`finviz_http_${response.status}_view_${view}`);
      }

      const rows = await csvToJson().fromString(String(response.data || ''));
      return toTickerMap(rows);
    } catch (error) {
      lastError = error;
      await sleep(1500 * attempt);
    }
  }

  throw lastError || new Error(`finviz_view_${view}_failed`);
}

async function fetchOpenRangeMetrics() {
  const result = await queryWithTimeout(
    `WITH target AS (
       SELECT UNNEST($1::text[]) AS symbol
     ),
     latest_metrics AS (
       SELECT DISTINCT ON (m.symbol)
         m.symbol,
         m.price,
         m.change_percent,
         m.gap_percent,
         m.relative_volume,
         m.volume,
         m.atr,
         m.updated_at,
         m.last_updated
       FROM market_metrics m
       JOIN target t ON t.symbol = m.symbol
       ORDER BY m.symbol, COALESCE(m.updated_at, m.last_updated) DESC NULLS LAST
     ),
     latest_quotes AS (
       SELECT DISTINCT ON (q.symbol)
         q.symbol,
         q.price,
         q.change_percent,
         q.volume,
         q.market_cap,
         q.short_float,
         q.updated_at,
         q.last_updated
       FROM market_quotes q
       JOIN target t ON t.symbol = q.symbol
       ORDER BY q.symbol, COALESCE(q.updated_at, q.last_updated) DESC NULLS LAST
     ),
     ranked_daily AS (
       SELECT
         d.symbol,
         d.date,
         d.close,
         ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn
       FROM daily_ohlc d
       JOIN target t ON t.symbol = d.symbol
     ),
     sma_daily AS (
       SELECT
         symbol,
         AVG(close) FILTER (WHERE rn <= 20) AS sma20,
         AVG(close) FILTER (WHERE rn <= 50) AS sma50,
         AVG(close) FILTER (WHERE rn <= 200) AS sma200
       FROM ranked_daily
       GROUP BY symbol
     ),
     latest_intraday AS (
       SELECT DISTINCT ON (i.symbol)
         i.symbol,
         i.close::numeric AS latest_close,
         i.timestamp AS latest_timestamp
       FROM intraday_1m i
       JOIN target t ON t.symbol = i.symbol
       ORDER BY i.symbol, i.timestamp DESC
     ),
     intraday_4h AS (
       SELECT DISTINCT ON (i.symbol)
         i.symbol,
         i.close::numeric AS close_4h_ago,
         i.timestamp AS timestamp_4h_ago
       FROM intraday_1m i
       JOIN target t ON t.symbol = i.symbol
       WHERE i.timestamp <= NOW() - INTERVAL '4 hours'
       ORDER BY i.symbol, i.timestamp DESC
     )
     SELECT
       t.symbol,
       COALESCE(lm.price, lq.price) AS price,
       COALESCE(lm.change_percent, lq.change_percent) AS change_percent,
       COALESCE(lm.volume, lq.volume) AS volume,
       COALESCE(lm.gap_percent, NULL) AS gap_percent,
       COALESCE(lm.relative_volume, NULL) AS relative_volume,
       COALESCE(lm.atr, NULL) AS atr,
       lq.market_cap,
       lq.short_float,
       sd.sma20,
       sd.sma50,
       sd.sma200,
       li.latest_close,
       i4.close_4h_ago
     FROM target t
     LEFT JOIN latest_metrics lm ON lm.symbol = t.symbol
     LEFT JOIN latest_quotes lq ON lq.symbol = t.symbol
     LEFT JOIN sma_daily sd ON sd.symbol = t.symbol
     LEFT JOIN latest_intraday li ON li.symbol = t.symbol
     LEFT JOIN intraday_4h i4 ON i4.symbol = t.symbol
     ORDER BY t.symbol ASC`,
    [EXACT_TICKERS],
    { timeoutMs: 20000, label: 'export.ticker_field_snapshot_24.metrics', maxRetries: 0 }
  );

  return new Map((result.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
}

function distancePercent(price, movingAverage) {
  const safePrice = toNumber(price);
  const safeAverage = toNumber(movingAverage);
  if (safePrice === null || safeAverage === null || safeAverage === 0) return null;
  return Number((((safePrice - safeAverage) / safeAverage) * 100).toFixed(2));
}

function performancePercent(currentPrice, historicalPrice) {
  const current = toNumber(currentPrice);
  const historical = toNumber(historicalPrice);
  if (current === null || historical === null || historical === 0) return null;
  return Number((((current - historical) / historical) * 100).toFixed(2));
}

function formatRow(ticker, finvizOwnership, finvizPerformance, metrics) {
  const price = toNumber(finvizPerformance?.Price) ?? toNumber(metrics?.price);
  const change = toNumber(finvizPerformance?.Change) ?? toNumber(metrics?.change_percent);
  const volume = toNumber(finvizPerformance?.Volume) ?? toNumber(metrics?.volume);
  const relVolume = toNumber(finvizPerformance?.['Relative Volume']) ?? toNumber(metrics?.relative_volume);
  const marketCapMillions = toNumber(finvizOwnership?.['Market Cap']);
  const marketCap = marketCapMillions !== null
    ? Math.round(marketCapMillions * 1_000_000)
    : toNumber(metrics?.market_cap);

  return {
    Ticker: ticker,
    'Market Cap': marketCap,
    'Short Float': toNumber(finvizOwnership?.['Short Float']) ?? toNumber(metrics?.short_float),
    'Perf 4 Hr': performancePercent(metrics?.latest_close ?? price, metrics?.close_4h_ago),
    'Perf Month': toNumber(finvizPerformance?.['Performance (Month)']),
    ATR: toNumber(metrics?.atr),
    SMA20: distancePercent(price, metrics?.sma20),
    SMA50: distancePercent(price, metrics?.sma50),
    SMA200: distancePercent(price, metrics?.sma200),
    Gap: toNumber(metrics?.gap_percent),
    'Rel Volume': relVolume,
    Volume: volume,
    Price: price,
    Change: change,
  };
}

async function run() {
  const [ownershipView, performanceView, metricsMap] = await Promise.all([
    fetchFinvizView(131).catch(() => new Map()),
    fetchFinvizView(141).catch(() => new Map()),
    fetchOpenRangeMetrics(),
  ]);

  const headers = [
    'Ticker',
    'Market Cap',
    'Short Float',
    'Perf 4 Hr',
    'Perf Month',
    'ATR',
    'SMA20',
    'SMA50',
    'SMA200',
    'Gap',
    'Rel Volume',
    'Volume',
    'Price',
    'Change',
  ];

  const rows = EXACT_TICKERS.map((ticker) => formatRow(
    ticker,
    ownershipView.get(ticker) || null,
    performanceView.get(ticker) || null,
    metricsMap.get(ticker) || null
  ));

  const csvLines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ];

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${csvLines.join('\n')}\n`, 'utf8');

  console.log(`Created ${REPORT_PATH}`);
  console.log(JSON.stringify({ rows: rows.length, tickers: rows.map((row) => row.Ticker) }, null, 2));
}

run()
  .catch((error) => {
    console.error('[EXPORT_TICKER_FIELD_SNAPSHOT_24] failed', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_error) {
      // ignore pool shutdown errors in one-shot script
    }
  });