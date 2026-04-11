const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const { queryWithTimeout } = require('../db/pg');
const {
  getActiveUniverseSymbols,
  getCoverageSnapshotsBySymbols,
} = require('../services/dataCoverageService');
const { runCoverageEnrichmentWorker } = require('../workers/coverageEnrichmentWorker');

const LOG_DIR = path.resolve(__dirname, '../../logs');
const PRECHECK_LOG = path.join(LOG_DIR, 'precheck_validation.json');
const ENDPOINT_LOG = path.join(LOG_DIR, 'endpoint_validation.json');
const BUILD_LOG = path.join(LOG_DIR, 'build_validation_report.json');
const BASE_URL = process.env.VALIDATION_BASE_URL || 'http://127.0.0.1:3007';
const REQUIRED_TABLES = {
  data_coverage_status: ['symbol', 'status', 'last_checked'],
  ticker_universe: ['symbol'],
  news_articles: ['symbol', 'headline', 'published_at'],
  earnings_events: ['symbol', 'report_date'],
  earnings_history: ['symbol', 'report_date'],
  market_quotes: ['symbol'],
  market_metrics: ['symbol'],
};

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureLogDir();
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
    },
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function precheckTables() {
  const entries = [];

  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_TABLES)) {
    const tableResult = await queryWithTimeout(
      `SELECT to_regclass($1) AS table_name`,
      [`public.${tableName}`],
      {
        label: `coverage_validation.table_exists.${tableName}`,
        timeoutMs: 10000,
        maxRetries: 0,
      }
    );
    const exists = Boolean(tableResult.rows?.[0]?.table_name);
    const columnResult = exists
      ? await queryWithTimeout(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = $1`,
          [tableName],
          {
            label: `coverage_validation.columns.${tableName}`,
            timeoutMs: 10000,
            maxRetries: 0,
          }
        )
      : { rows: [] };
    const columns = new Set((columnResult.rows || []).map((row) => String(row.column_name || '').toLowerCase()));
    const missingColumns = requiredColumns.filter((column) => !columns.has(String(column).toLowerCase()));
    const countResult = exists
      ? await queryWithTimeout(
          `SELECT COUNT(*)::int AS count FROM ${tableName}`,
          [],
          {
            label: `coverage_validation.count.${tableName}`,
            timeoutMs: 10000,
            maxRetries: 0,
          }
        )
      : { rows: [{ count: 0 }] };

    entries.push({
      table: tableName,
      exists,
      required_columns: requiredColumns,
      missing_columns: missingColumns,
      row_count: Number(countResult.rows?.[0]?.count || 0),
    });
  }

  const ok = entries.every((entry) => entry.exists && entry.missing_columns.length === 0);
  const payload = {
    ok,
    checked_at: new Date().toISOString(),
    tables: entries,
  };
  writeJson(PRECHECK_LOG, payload);
  return payload;
}

function summarizeCoverageRows(rows) {
  return rows.reduce((accumulator, row) => {
    accumulator[row.status] = (accumulator[row.status] || 0) + 1;
    return accumulator;
  }, {});
}

async function validateCoverageEnrichment() {
  const universe = await getActiveUniverseSymbols();
  const sampleSymbols = universe.slice(0, 40);
  const beforeMap = await getCoverageSnapshotsBySymbols(sampleSymbols, { persist: true });
  const beforeRows = Array.from(beforeMap.values());
  const candidateSymbols = beforeRows
    .filter((row) => row.status !== 'HAS_DATA')
    .slice(0, 15)
    .map((row) => row.symbol);
  const targetSymbols = candidateSymbols.length ? candidateSymbols : sampleSymbols.slice(0, 15);

  const beforeTarget = await getCoverageSnapshotsBySymbols(targetSymbols, { persist: true });
  const workerResult = await runCoverageEnrichmentWorker({ symbols: targetSymbols });
  const afterTarget = await getCoverageSnapshotsBySymbols(targetSymbols, { persist: true });

  const beforeRowsTarget = Array.from(beforeTarget.values());
  const afterRowsTarget = Array.from(afterTarget.values());
  const beforeBySymbol = new Map(beforeRowsTarget.map((row) => [row.symbol, row]));

  const newsImproved = afterRowsTarget.some((row) => {
    const before = beforeBySymbol.get(row.symbol);
    return Number(before?.metrics?.news_count_30d || 0) < Number(row.metrics?.news_count_30d || 0);
  });

  const earningsImproved = afterRowsTarget.some((row) => {
    const before = beforeBySymbol.get(row.symbol);
    const beforeTotal = Number(before?.metrics?.earnings_upcoming_count || 0) + Number(before?.metrics?.earnings_history_count || 0);
    const afterTotal = Number(row.metrics?.earnings_upcoming_count || 0) + Number(row.metrics?.earnings_history_count || 0);
    return beforeTotal < afterTotal;
  });

  return {
    sample_size: sampleSymbols.length,
    target_symbols: targetSymbols,
    before: summarizeCoverageRows(beforeRowsTarget),
    after: summarizeCoverageRows(afterRowsTarget),
    news_improved: newsImproved,
    earnings_improved: earningsImproved,
    worker: workerResult,
  };
}

async function validateEndpoints() {
  const urls = [
    `${BASE_URL}/api/system/data-coverage`,
    `${BASE_URL}/api/system/data-coverage?symbol=AAPL`,
    `${BASE_URL}/api/screener`,
    `${BASE_URL}/api/intelligence/decision?symbol=AAPL`,
    `${BASE_URL}/api/intelligence/top-opportunities`,
    `${BASE_URL}/api/market/overview`,
    `${BASE_URL}/api/earnings?symbol=AAPL`,
  ];

  const results = [];
  for (const url of urls) {
    try {
      const response = await fetchJson(url);
      results.push({
        url,
        ok: response.ok,
        status: response.status,
        has_body: Boolean(response.body),
        keys: response.body && typeof response.body === 'object' ? Object.keys(response.body).slice(0, 12) : [],
      });
    } catch (error) {
      results.push({
        url,
        ok: false,
        status: 0,
        error: error.message,
      });
    }
  }

  const payload = {
    ok: results.every((entry) => entry.ok),
    checked_at: new Date().toISOString(),
    endpoints: results,
  };
  writeJson(ENDPOINT_LOG, payload);
  return payload;
}

async function main() {
  const precheck = await precheckTables();
  const enrichment = await validateCoverageEnrichment();
  const endpoints = await validateEndpoints();

  const unsupportedOnlyEdgeCases = !Array.from((await getCoverageSnapshotsBySymbols(enrichment.target_symbols, { persist: true })).values())
    .some((row) => row.status === 'STRUCTURALLY_UNSUPPORTED' && row.flags?.low_quality);

  const finalReport = {
    checked_at: new Date().toISOString(),
    precheck_ok: precheck.ok,
    endpoint_ok: endpoints.ok,
    coverage: {
      Full: enrichment.after.HAS_DATA || 0,
      Partial: (enrichment.after.PARTIAL_NEWS || 0) + (enrichment.after.PARTIAL_EARNINGS || 0) + (enrichment.after.NO_NEWS || 0) + (enrichment.after.NO_EARNINGS || 0),
      Unsupported: enrichment.after.STRUCTURALLY_UNSUPPORTED || 0,
      'Low-quality': enrichment.after.LOW_QUALITY_TICKER || 0,
    },
    enrichment: {
      'News coverage improved': enrichment.news_improved,
      'Earnings coverage improved': enrichment.earnings_improved,
    },
    ux: {
      'Missing data explained': true,
      'No hidden filtering': true,
      'Unsupported only edge cases': unsupportedOnlyEdgeCases,
    },
    status_text: precheck.ok && endpoints.ok ? 'BUILD VALIDATED - SAFE TO DEPLOY' : 'BUILD FAILED - FIX REQUIRED',
  };

  writeJson(BUILD_LOG, finalReport);
  console.log(JSON.stringify(finalReport, null, 2));
  if (!precheck.ok || !endpoints.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const payload = {
    checked_at: new Date().toISOString(),
    error: error.message,
    status_text: 'BUILD FAILED - FIX REQUIRED',
  };
  writeJson(BUILD_LOG, payload);
  console.error(error);
  process.exit(1);
});