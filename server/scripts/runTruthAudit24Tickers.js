#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const { fetchSymbolAuditData: fetchFinvizSymbol } = require('../adapters/finvizAdapter');
const { fetchSymbolAuditData: fetchUnusualWhalesSymbol } = require('../adapters/unusualWhalesAdapter');

const API_BASE = process.env.TRUTH_AUDIT_API_BASE || 'http://127.0.0.1:3007';
const CSV_OUTPUT_PATH = path.resolve(__dirname, '..', '..', 'reports', 'truth-audit-24-tickers.csv');

const EXACT_TICKERS = [
  'PLTR', 'SOFI', 'RKLB', 'UPST', 'BB', 'OPEN',
  'DKNG', 'RBLX', 'AFRM', 'NET', 'SNAP', 'COIN',
  'AMD', 'SHOP', 'UBER', 'BA', 'PYPL', 'DIS',
  'AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'META',
];

function uniqueTickers(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const ticker = String(value || '').trim().toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
  }
  return out;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await response.json();
  return { ok: response.ok, status: response.status, body };
}

async function fetchFinvizWithRetry(ticker, maxAttempts = 3) {
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await fetchFinvizSymbol(ticker);
    if (lastResult?.available) {
      return { result: lastResult, failed: false };
    }
  }
  return { result: lastResult, failed: true };
}

function deriveStatus(openrange, finviz, unusualWhales) {
  const hasOpenRange = Boolean(openrange);
  const hasFinviz = Boolean(finviz);
  const hasUw = Boolean(unusualWhales);
  if (hasOpenRange && (hasFinviz || hasUw)) return 'complete';
  if (hasOpenRange || hasFinviz || hasUw) return 'partial';
  return 'missing';
}

function printTable(rows) {
  console.log('Ticker | Price | RVOL | Volume | News | Earnings | Verdict');
  for (const row of rows) {
    const openrange = row.openrange || {};
    console.log([
      row.ticker,
      openrange.price ?? 'NA',
      openrange.relative_volume ?? 'NA',
      openrange.volume ?? 'NA',
      openrange.news_count ?? 'NA',
      openrange.earnings?.next_date ?? 'NA',
      row.status,
    ].join(' | '));
  }
}

async function run() {
  const tickers = uniqueTickers(EXACT_TICKERS);
  if (tickers.length !== 24) {
    throw new Error('Ticker list mismatch');
  }

  console.log(`Running audit for 24 tickers: ${JSON.stringify(tickers)}`);

  const batchUrl = `${API_BASE}/api/truth-audit?tickers=${encodeURIComponent(tickers.join(','))}`;
  const batchResponse = await fetchJson(batchUrl);
  if (!batchResponse.ok) {
    throw new Error(`Batch OpenRange fetch failed with status ${batchResponse.status}`);
  }

  const openRangeRows = Array.isArray(batchResponse.body?.rows) ? batchResponse.body.rows : [];
  if (openRangeRows.length !== 24) {
    throw new Error('Ticker list mismatch');
  }

  const openRangeByTicker = new Map(openRangeRows.map((row) => [String(row.ticker || '').trim().toUpperCase(), row]));
  const failedExternalFetch = [];
  const missingOpenRangeData = [];
  const finalRows = [];

  for (let index = 0; index < tickers.length; index += 5) {
    const batch = tickers.slice(index, index + 5);
    const finvizBatch = await Promise.all(batch.map(async (ticker) => {
      const finvizFetch = await fetchFinvizWithRetry(ticker, 3);
      if (finvizFetch.failed) {
        failedExternalFetch.push(ticker);
      }
      return [ticker, finvizFetch.result?.available ? finvizFetch.result : null];
    }));

    const uwBatch = await Promise.all(batch.map(async (ticker) => {
      const result = await fetchUnusualWhalesSymbol(ticker);
      return [ticker, result?.available ? result : null, result];
    }));

    const finvizMap = new Map(finvizBatch);
    const uwMap = new Map(uwBatch.map(([ticker, availableResult, rawResult]) => [ticker, { availableResult, rawResult }]));

    for (const ticker of batch) {
      const openrangeRow = openRangeByTicker.get(ticker) || { ticker, openrange: null, status: 'missing' };
      const openrange = openrangeRow.openrange || null;
      if (!openrange) {
        missingOpenRangeData.push(ticker);
      }
      const finviz = finvizMap.get(ticker) || null;
      const uwEntry = uwMap.get(ticker) || { availableResult: null, rawResult: null };
      const unusualWhales = uwEntry.availableResult;
      const status = deriveStatus(openrange, finviz, unusualWhales);

      finalRows.push({
        ticker,
        openrange,
        finviz,
        unusual_whales: unusualWhales,
        status,
      });
    }
  }

  if (finalRows.length !== 24) {
    throw new Error('Ticker list mismatch');
  }

  const missingTickers = tickers.filter((ticker) => !finalRows.some((row) => row.ticker === ticker));
  if (missingTickers.length > 0) {
    throw new Error('Ticker list mismatch');
  }

  const csvHeader = [
    'ticker',
    'status',
    'openrange_price',
    'openrange_rvol',
    'openrange_volume',
    'openrange_news',
    'openrange_earnings',
    'openrange_driver',
    'openrange_tradeability',
    'openrange_confidence',
    'finviz_price',
    'finviz_change_percent',
    'finviz_volume',
    'finviz_news_count',
    'finviz_earnings_date',
    'unusual_whales_price',
    'unusual_whales_change_percent',
    'unusual_whales_volume',
    'unusual_whales_news_count',
    'unusual_whales_earnings_date',
  ];

  const csvRows = finalRows.map((row) => {
    const openrange = row.openrange || {};
    const finviz = row.finviz || {};
    const unusualWhales = row.unusual_whales || {};
    return [
      row.ticker,
      row.status,
      openrange.price,
      openrange.relative_volume,
      openrange.volume,
      openrange.news_count,
      openrange.earnings?.next_date,
      openrange.driver,
      openrange.tradeability,
      openrange.confidence,
      finviz.price,
      finviz.change_percent,
      finviz.volume,
      finviz.news_count,
      finviz.earnings_date,
      unusualWhales.price,
      unusualWhales.change_percent,
      unusualWhales.volume,
      unusualWhales.news_count,
      unusualWhales.earnings_date,
    ].map(csvEscape).join(',');
  });

  fs.mkdirSync(path.dirname(CSV_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(CSV_OUTPUT_PATH, `${csvHeader.join(',')}\n${csvRows.join('\n')}\n`, 'utf8');

  printTable(finalRows);

  if (csvRows.length !== 24) {
    throw new Error('Ticker list mismatch');
  }

  console.log('FAILED_EXTERNAL_FETCH:');
  console.log(JSON.stringify(uniqueTickers(failedExternalFetch)));
  console.log('MISSING_OPENRANGE_DATA:');
  console.log(JSON.stringify(uniqueTickers(missingOpenRangeData)));

  const validation = {
    tickers_expected: 24,
    tickers_processed: finalRows.length,
    missing: missingTickers,
  };

  if (validation.tickers_processed !== 24) {
    throw new Error('Ticker list mismatch');
  }

  console.log(JSON.stringify(validation, null, 2));
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});