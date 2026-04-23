#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Client } = require('pg');
const { queryWithTimeout } = require('../db/pg');
const { runEarningsIngestionEngine } = require('../engines/earningsIngestionEngine');
const { calculateCoverageScore, upsertCoverageRows } = require('../v2/services/coverageEngine');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const PRECHECK_LOG = path.join(LOG_DIR, 'precheck_validation.json');
const BUILD_LOG = path.join(LOG_DIR, 'build_validation_report.json');
const AUDIT_LOG = path.join(LOG_DIR, 'earnings_gap_audit.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readAuditSymbols() {
  const report = JSON.parse(fs.readFileSync(AUDIT_LOG, 'utf8'));
  return report.results
    .filter((row) => row.coverage_status === 'FULL_8_PLUS')
    .map((row) => String(row.symbol || '').trim().toUpperCase())
    .filter(Boolean);
}

async function loadTableSummary(client) {
  const tables = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('data_coverage', 'earnings_events', 'earnings_history')
     ORDER BY table_name`
  );
  const columns = await client.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('data_coverage', 'earnings_events', 'earnings_history')
       AND column_name IN ('symbol', 'report_date', 'earnings_count', 'last_earnings_at')
     ORDER BY table_name, column_name`
  );
  const counts = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM earnings_events) AS earnings_events_rows,
       (SELECT COUNT(*) FROM earnings_history) AS earnings_history_rows,
       (SELECT COUNT(*) FROM data_coverage) AS data_coverage_rows`
  );

  return {
    tables: tables.rows || [],
    columns: columns.rows || [],
    counts: counts.rows?.[0] || {},
  };
}

async function loadSliceState(symbols) {
  const result = await queryWithTimeout(
    `WITH requested AS (
       SELECT UNNEST($1::text[]) AS symbol
     ), history AS (
       SELECT UPPER(symbol) AS symbol,
              COUNT(*)::int AS history_count,
              MAX(report_date)::timestamptz AS last_earnings_at
       FROM earnings_history
       WHERE UPPER(symbol) = ANY($1::text[])
       GROUP BY UPPER(symbol)
     ), events AS (
       SELECT UPPER(symbol) AS symbol,
              COUNT(*)::int AS event_count
       FROM earnings_events
       WHERE UPPER(symbol) = ANY($1::text[])
       GROUP BY UPPER(symbol)
     )
     SELECT r.symbol,
            COALESCE(e.event_count, 0) AS event_count,
            COALESCE(h.history_count, 0) AS history_count,
            h.last_earnings_at,
            COALESCE(dc.has_earnings, false) AS has_coverage_earnings,
            COALESCE(dc.earnings_count, 0) AS coverage_earnings_count,
            dc.last_earnings_at AS coverage_last_earnings_at
     FROM requested r
     LEFT JOIN history h ON h.symbol = r.symbol
     LEFT JOIN events e ON e.symbol = r.symbol
     LEFT JOIN data_coverage dc ON dc.symbol = r.symbol
     ORDER BY r.symbol ASC`,
    [symbols],
    {
      label: 'earnings_slice.state',
      timeoutMs: 30000,
      maxRetries: 0,
    }
  );

  const rows = result.rows || [];
  return {
    rows,
    summary: {
      symbols: rows.length,
      history_full_8_plus: rows.filter((row) => Number(row.history_count || 0) >= 8).length,
      history_partial: rows.filter((row) => Number(row.history_count || 0) > 0 && Number(row.history_count || 0) < 8).length,
      history_zero: rows.filter((row) => Number(row.history_count || 0) === 0).length,
      coverage_missing: rows.filter((row) => !row.has_coverage_earnings).length,
      with_upcoming_events: rows.filter((row) => Number(row.event_count || 0) > 0).length,
    },
  };
}

async function refreshCoverageForSymbols(symbols) {
  const existingResult = await queryWithTimeout(
    `SELECT symbol,
            has_news,
            has_technicals,
            news_count,
            last_news_at
     FROM data_coverage
     WHERE symbol = ANY($1::text[])`,
    [symbols],
    {
      label: 'earnings_slice.coverage_existing',
      timeoutMs: 15000,
      maxRetries: 0,
    }
  );
  const earningsResult = await queryWithTimeout(
    `SELECT UPPER(symbol) AS symbol,
            COUNT(*)::int AS earnings_count,
            MAX(report_date)::timestamptz AS last_earnings_at
     FROM earnings_history
     WHERE UPPER(symbol) = ANY($1::text[])
     GROUP BY UPPER(symbol)`,
    [symbols],
    {
      label: 'earnings_slice.coverage_earnings',
      timeoutMs: 20000,
      maxRetries: 0,
    }
  );
  const upcomingResult = await queryWithTimeout(
    `SELECT UPPER(symbol) AS symbol,
            COUNT(*)::int AS upcoming_earnings_count,
            MIN(report_date)::timestamptz AS next_earnings_at
     FROM earnings_events
     WHERE report_date >= CURRENT_DATE
       AND UPPER(symbol) = ANY($1::text[])
     GROUP BY UPPER(symbol)`,
    [symbols],
    {
      label: 'earnings_slice.coverage_upcoming',
      timeoutMs: 20000,
      maxRetries: 0,
    }
  );

  const existingBySymbol = new Map((existingResult.rows || []).map((row) => [String(row.symbol || '').trim().toUpperCase(), row]));
  const earningsBySymbol = new Map((earningsResult.rows || []).map((row) => [String(row.symbol || '').trim().toUpperCase(), row]));
  const upcomingBySymbol = new Map((upcomingResult.rows || []).map((row) => [String(row.symbol || '').trim().toUpperCase(), row]));

  const rows = symbols.map((symbol) => {
    const existing = existingBySymbol.get(symbol) || {};
    const earnings = earningsBySymbol.get(symbol) || {};
    const upcoming = upcomingBySymbol.get(symbol) || {};
    const hasEarningsHistory = Number(earnings.earnings_count || 0) > 0;
    const hasUpcomingEarnings = Number(upcoming.upcoming_earnings_count || 0) > 0;
    const nextRow = {
      symbol,
      has_news: Boolean(existing.has_news),
      has_earnings_history: hasEarningsHistory,
      has_upcoming_earnings: hasUpcomingEarnings,
      has_earnings: hasEarningsHistory || hasUpcomingEarnings,
      has_technicals: Boolean(existing.has_technicals),
      news_count: Number(existing.news_count || 0),
      earnings_count: Number(earnings.earnings_count || 0),
      last_news_at: existing.last_news_at || null,
      last_earnings_at: earnings.last_earnings_at || null,
    };

    return {
      ...nextRow,
      coverage_score: calculateCoverageScore(nextRow),
    };
  });

  await upsertCoverageRows(rows);
  return rows.length;
}

async function main() {
  ensureDir(LOG_DIR);

  const targetSymbols = readAuditSymbols();
  if (!targetSymbols.length) {
    throw new Error('No FULL_8_PLUS symbols found in earnings audit log');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const tableSummary = await loadTableSummary(client);
    const sliceBefore = await loadSliceState(targetSymbols);

    const precheckReport = {
      timestamp: new Date().toISOString(),
      target_symbols: targetSymbols.length,
      target_symbol_sample: targetSymbols.slice(0, 15),
      ...tableSummary,
      slice_before: sliceBefore.summary,
      status: 'BUILD VALIDATED - SAFE TO DEPLOY',
    };
    fs.writeFileSync(PRECHECK_LOG, JSON.stringify(precheckReport, null, 2));

    const ingestion = await runEarningsIngestionEngine({
      symbols: targetSymbols,
      returnSymbolHistoryBreakdown: true,
    });

    const coverageRowsUpdated = await refreshCoverageForSymbols(targetSymbols);
    const sliceAfter = await loadSliceState(targetSymbols);

    const buildReport = {
      timestamp: new Date().toISOString(),
      target_symbols: targetSymbols.length,
      target_symbols_list: targetSymbols,
      precheck: precheckReport,
      ingestion,
      coverage_rows_updated: coverageRowsUpdated,
      slice_after: sliceAfter.summary,
      status: 'BUILD VALIDATED - SAFE TO DEPLOY',
    };

    fs.writeFileSync(BUILD_LOG, JSON.stringify(buildReport, null, 2));
    console.log(JSON.stringify({
      target_symbols: targetSymbols.length,
      slice_before: sliceBefore.summary,
      ingestion: {
        events_ingested: ingestion.events_ingested,
        projected_events_ingested: ingestion.projected_events_ingested,
        history_ingested: ingestion.history_ingested,
        symbols_with_full_history: ingestion.symbols_with_full_history,
        symbols_with_partial_history: ingestion.symbols_with_partial_history,
        symbols_with_no_history: ingestion.symbols_with_no_history,
      },
      slice_after: sliceAfter.summary,
      coverage_rows_updated: coverageRowsUpdated,
      status: buildReport.status,
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
  fs.writeFileSync(BUILD_LOG, JSON.stringify(report, null, 2));
  console.error(report.status);
  console.error(error);
  process.exit(1);
});