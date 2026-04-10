#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const { queryWithTimeout } = require('../db/pg');
const { runFullUniverseRefresh, getCoverageStats } = require('../engines/fullUniverseRefreshEngine');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_PATH = path.resolve(ROOT, 'system_diagnostic_report.json');

async function getSchedulerActive() {
  try {
    const res = await fetch('http://localhost:3007/api/system/engine-diagnostics');
    if (!res.ok) return false;
    const body = await res.json();
    const status = String(body?.scheduler?.status || '').toLowerCase();
    return status === 'running' || status === 'idle';
  } catch (_error) {
    return false;
  }
}

async function getFreshCounts() {
  const { rows } = await queryWithTimeout(
    `SELECT
      (SELECT COUNT(*)::int FROM market_quotes WHERE COALESCE(last_updated, updated_at) > NOW() - INTERVAL '60 seconds') AS fresh_quotes_count,
      (SELECT COUNT(DISTINCT UPPER(symbol))::int FROM ticker_universe WHERE symbol IS NOT NULL AND BTRIM(symbol) <> '') AS total_universe_count`,
    [],
    { timeoutMs: 10000, label: 'diag.refresh_counts', maxRetries: 0, poolType: 'read' }
  );
  return rows[0] || { fresh_quotes_count: 0, total_universe_count: 0 };
}

async function callScreener() {
  try {
    const res = await fetch('http://localhost:3007/api/screener?page=1&pageSize=25');
    const body = await res.json();
    return { status: res.status, body };
  } catch (error) {
    return { status: 0, body: { success: false, error: error.message } };
  }
}

function inferRootCause({ schedulerActive, apiFailures, dbWriteSuccess, coverage }) {
  if (!schedulerActive) return 'scheduler not running';
  if (apiFailures > 0) return 'API failing';
  if (!dbWriteSuccess) return 'DB writes failing';
  if (coverage < 0.7) return 'timestamps incorrect';
  return 'none';
}

(async () => {
  const schedulerActive = await getSchedulerActive();

  let refreshResult = null;
  let refreshError = null;
  try {
    refreshResult = await runFullUniverseRefresh();
  } catch (error) {
    refreshError = error;
  }

  const coverageStats = await getCoverageStats();
  const counts = await getFreshCounts();
  const screener = await callScreener();

  const symbolsLoaded = Number(refreshResult?.total_symbols || 0);
  const quotesWritten = Number(refreshResult?.quotes_updated || 0);
  const freshQuotesCount = Number(counts.fresh_quotes_count || 0);
  const coverage = Number(coverageStats?.coverage || 0);
  const apiFailures = Number(refreshResult?.api_failures || 0);
  const refreshErrorMessage = String(refreshError?.message || '');
  const dbTimeoutFailure = /timeout|canceling statement|query failed/i.test(refreshErrorMessage);
  const dbWriteSuccess = (quotesWritten > 0 && freshQuotesCount > 0) || (!refreshError && freshQuotesCount > 0);
  const refreshEngineRunning = !refreshError && symbolsLoaded > 0;
  const screenerSuccess = Boolean(screener?.body?.success === true);

  const rootCause = (!schedulerActive)
    ? 'scheduler not running'
    : (dbTimeoutFailure
      ? 'DB writes failing'
      : inferRootCause({
    schedulerActive,
    apiFailures,
    dbWriteSuccess,
    coverage,
      }));

  const finalStatus = coverage >= 0.7 && screenerSuccess ? 'PASS' : 'FAIL';

  const report = {
    refresh_engine_running: refreshEngineRunning,
    scheduler_active: schedulerActive,
    symbols_loaded: symbolsLoaded,
    quotes_written: quotesWritten,
    fresh_quotes_count: freshQuotesCount,
    coverage,
    api_failures: apiFailures,
    db_write_success: dbWriteSuccess,
    final_status: finalStatus,
    root_cause: finalStatus === 'PASS' ? 'none' : rootCause,
  };

  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
})();
