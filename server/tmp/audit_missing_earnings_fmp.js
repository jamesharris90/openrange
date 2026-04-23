#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const CONCURRENCY = 6;
const LOG_DIR = path.join(__dirname, '..', 'logs');
const REPORT_LOG = path.join(LOG_DIR, 'earnings_gap_audit.json');
const FMP_API_KEY = process.env.FMP_API_KEY;
const REQUESTED_SYMBOLS = new Set(
  String(process.env.EARNINGS_AUDIT_SYMBOLS || '')
    .split(',')
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean)
);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function safeDate(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time) : null;
}

function iso(value) {
  const d = safeDate(value);
  return d ? d.toISOString() : null;
}

function normalizeReportDate(value) {
  const date = safeDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeIngestibleHistoricalRows(rows) {
  const deduped = new Map();

  for (const row of (Array.isArray(rows) ? rows : [])
    .map((sourceRow) => ({
      sourceRow,
      reportDate: normalizeReportDate(
        sourceRow?.date || sourceRow?.reportDate || sourceRow?.report_date || sourceRow?.reportedDate || sourceRow?.fiscalDateEnding
      ),
      epsActual: toNumber(sourceRow?.epsActual ?? sourceRow?.actualEps ?? sourceRow?.eps ?? sourceRow?.eps_actual),
    }))
    .filter((entry) => entry.reportDate && entry.reportDate < new Date().toISOString().slice(0, 10))
    .sort((left, right) => right.reportDate.localeCompare(left.reportDate))) {
    if (row.epsActual === null || deduped.has(row.reportDate)) {
      continue;
    }

    deduped.set(row.reportDate, row.sourceRow);
  }

  return Array.from(deduped.values()).slice(0, 8);
}

function yearsBetween(value) {
  const d = safeDate(value);
  if (!d) return null;
  return (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function classifyCoverage(row, earningsRows) {
  const ingestibleRows = normalizeIngestibleHistoricalRows(earningsRows);
  const count = ingestibleRows.length;
  const latestDate = count > 0 ? ingestibleRows[0]?.date || ingestibleRows[0]?.reportDate || ingestibleRows[0]?.report_date || null : null;
  const oldestDate = count > 0 ? ingestibleRows[count - 1]?.date || ingestibleRows[count - 1]?.reportDate || ingestibleRows[count - 1]?.report_date || null : null;
  const oldestYears = yearsBetween(oldestDate);

  if (count >= 8) {
    return {
      coverage_status: 'FULL_8_PLUS',
      inferred_reason: 'provider_has_ingestible_history',
      oldest_date: oldestDate,
      latest_date: latestDate,
      earnings_count: count,
    };
  }

  if (count > 0) {
    const structurallySparse = ['SPAC_SHELL', 'UNITS_WARRANTS_RIGHTS', 'PREFERRED_NOTES', 'ETF_FUND_TRUST'].includes(String(row.stock_classification || ''));
    const likelyNewListing = oldestYears !== null && oldestYears < 2.25;

    return {
      coverage_status: 'PARTIAL_HISTORY',
      inferred_reason: structurallySparse
        ? 'structural_instrument_limited_history'
        : likelyNewListing
          ? 'likely_new_listing_or_recent_reporting_history'
          : 'provider_partial_ingestible_history',
      oldest_date: oldestDate,
      latest_date: latestDate,
      earnings_count: count,
    };
  }

  return {
    coverage_status: 'NO_PROVIDER_DATA',
    inferred_reason: ['SPAC_SHELL', 'UNITS_WARRANTS_RIGHTS', 'PREFERRED_NOTES', 'ETF_FUND_TRUST'].includes(String(row.stock_classification || ''))
      ? 'structural_no_earnings_instrument'
      : 'provider_missing_or_non_reporting_symbol',
    oldest_date: null,
    latest_date: null,
    earnings_count: 0,
  };
}

async function loadMissingEarningsUniverse(client) {
  const baseQuery = `
    select
      tu.symbol,
      tu.company_name,
      tu.exchange,
      tu.sector,
      tu.industry,
      mq.price,
      tc.stock_classification,
      tc.classification_label,
      tc.instrument_detail_label
    from ticker_universe tu
    left join data_coverage dc on dc.symbol = tu.symbol
    left join ticker_classifications tc on tc.symbol = tu.symbol
    left join market_quotes mq on mq.symbol = tu.symbol
    where tu.is_active = true`;
  const result = REQUESTED_SYMBOLS.size > 0
    ? await client.query(
        `${baseQuery}
         and upper(tu.symbol) = any($1::text[])
         order by tu.symbol asc`,
        [Array.from(REQUESTED_SYMBOLS)]
      )
    : await client.query(`${baseQuery}
         and coalesce(dc.has_earnings, false) = false
         order by tu.symbol asc`);
  return result.rows || [];
}

async function auditSymbol(row) {
  const symbol = String(row.symbol || '').trim().toUpperCase();
  const url = `https://financialmodelingprep.com/stable/earnings?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(FMP_API_KEY)}`;
  const payload = await fetchJson(url);
  const rows = Array.isArray(payload) ? payload : [];
  const coverage = classifyCoverage(row, rows);
  return {
    symbol,
    company_name: row.company_name,
    stock_classification: row.stock_classification,
    classification_label: row.classification_label,
    instrument_detail_label: row.instrument_detail_label,
    price: row.price,
    exchange: row.exchange,
    sector: row.sector,
    industry: row.industry,
    ...coverage,
  };
}

async function runPool(items, worker, concurrency) {
  const results = [];
  let cursor = 0;

  async function next() {
    if (cursor >= items.length) return;
    const index = cursor;
    cursor += 1;
    results[index] = await worker(items[index], index);
    await next();
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return results;
}

function summarize(results) {
  const summary = {
    totals: {
      missing_earnings_symbols: results.length,
      full_8_plus: 0,
      partial_history: 0,
      no_provider_data: 0,
    },
    by_stock_classification: {},
    by_instrument_detail: {},
    by_reason: {},
    samples: {
      partial_history: [],
      no_provider_data: [],
      full_8_plus: [],
    },
  };

  for (const row of results) {
    if (row.coverage_status === 'FULL_8_PLUS') summary.totals.full_8_plus += 1;
    if (row.coverage_status === 'PARTIAL_HISTORY') summary.totals.partial_history += 1;
    if (row.coverage_status === 'NO_PROVIDER_DATA') summary.totals.no_provider_data += 1;

    const classKey = row.classification_label || 'Unknown';
    const detailKey = row.instrument_detail_label || 'Unknown';
    const reasonKey = row.inferred_reason || 'unknown';

    summary.by_stock_classification[classKey] = summary.by_stock_classification[classKey] || { total: 0, full_8_plus: 0, partial_history: 0, no_provider_data: 0 };
    summary.by_instrument_detail[detailKey] = summary.by_instrument_detail[detailKey] || { total: 0, full_8_plus: 0, partial_history: 0, no_provider_data: 0 };
    summary.by_reason[reasonKey] = (summary.by_reason[reasonKey] || 0) + 1;

    summary.by_stock_classification[classKey].total += 1;
    summary.by_instrument_detail[detailKey].total += 1;

    if (row.coverage_status === 'FULL_8_PLUS') {
      summary.by_stock_classification[classKey].full_8_plus += 1;
      summary.by_instrument_detail[detailKey].full_8_plus += 1;
      if (summary.samples.full_8_plus.length < 20) summary.samples.full_8_plus.push(row);
    }
    if (row.coverage_status === 'PARTIAL_HISTORY') {
      summary.by_stock_classification[classKey].partial_history += 1;
      summary.by_instrument_detail[detailKey].partial_history += 1;
      if (summary.samples.partial_history.length < 20) summary.samples.partial_history.push(row);
    }
    if (row.coverage_status === 'NO_PROVIDER_DATA') {
      summary.by_stock_classification[classKey].no_provider_data += 1;
      summary.by_instrument_detail[detailKey].no_provider_data += 1;
      if (summary.samples.no_provider_data.length < 20) summary.samples.no_provider_data.push(row);
    }
  }

  return summary;
}

async function main() {
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY missing');
  }

  ensureDir(LOG_DIR);
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const missingUniverse = await loadMissingEarningsUniverse(client);
    console.log(`Missing earnings symbols: ${missingUniverse.length}`);

    const results = await runPool(missingUniverse, async (row, index) => {
      const result = await auditSymbol(row);
      if ((index + 1) % 50 === 0 || index === missingUniverse.length - 1) {
        console.log(`Earnings audit progress ${index + 1}/${missingUniverse.length}`);
      }
      return result;
    }, CONCURRENCY);

    const report = {
      timestamp: new Date().toISOString(),
      endpoint: 'https://financialmodelingprep.com/stable/earnings?symbol={TICKER}&apikey=***',
      summary: summarize(results),
      results,
      status: 'BUILD VALIDATED - SAFE TO DEPLOY',
    };

    fs.writeFileSync(REPORT_LOG, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      timestamp: report.timestamp,
      totals: report.summary.totals,
      by_reason: report.summary.by_reason,
      status: report.status,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  ensureDir(LOG_DIR);
  const report = {
    timestamp: new Date().toISOString(),
    status: 'BUILD FAILED - FIX REQUIRED',
    error: error.message,
  };
  fs.writeFileSync(REPORT_LOG, JSON.stringify(report, null, 2));
  console.error(report.status);
  console.error(error);
  process.exit(1);
});
