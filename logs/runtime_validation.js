const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

const { queryWithTimeout } = require('../server/db/pg');

const OUTPUT_DIR = __dirname;
const PRECHECK_PATH = path.join(OUTPUT_DIR, 'precheck_validation.json');
const ENDPOINT_PATH = path.join(OUTPUT_DIR, 'endpoint_validation.json');
const BUILD_REPORT_PATH = path.join(OUTPUT_DIR, 'build_validation_report.json');

const tableChecks = [
  {
    table: 'screener_snapshots',
    columns: ['id', 'created_at', 'data'],
  },
  {
    table: 'intraday_1m',
    columns: ['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume'],
  },
  {
    table: 'daily_ohlc',
    columns: ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume'],
  },
];

const endpoints = [
  { name: 'backend_health', url: 'http://127.0.0.1:3007/api/health', repeats: 1 },
  { name: 'screener', url: 'http://127.0.0.1:3000/api/screener', repeats: 2 },
  { name: 'research_snapshot', url: 'http://127.0.0.1:3000/api/research/NVDA', repeats: 3 },
  { name: 'research_full', url: 'http://127.0.0.1:3000/api/research/NVDA/full', repeats: 3 },
  { name: 'chart_v5', url: 'http://127.0.0.1:3000/api/v5/chart?symbol=NVDA&interval=1day', repeats: 3 },
  { name: 'opportunities_next_session', url: 'http://127.0.0.1:3000/api/opportunities/next-session', repeats: 2 },
  { name: 'intelligence_decision', url: 'http://127.0.0.1:3000/api/intelligence/decision/NVDA', repeats: 1 },
  { name: 'intelligence_top_opportunities', url: 'http://127.0.0.1:3000/api/intelligence/top-opportunities', repeats: 1 },
  { name: 'market_overview', url: 'http://127.0.0.1:3000/api/market/overview', repeats: 1 },
  { name: 'earnings', url: 'http://127.0.0.1:3000/api/earnings', repeats: 1 },
];

function summarizePayload(payload) {
  if (payload === null || payload === undefined) {
    return { type: 'empty', topLevelKeys: [] };
  }

  if (Array.isArray(payload)) {
    return {
      type: 'array',
      length: payload.length,
      sampleKeys: payload[0] && typeof payload[0] === 'object' && !Array.isArray(payload[0]) ? Object.keys(payload[0]).slice(0, 12) : [],
    };
  }

  if (typeof payload === 'object') {
    return {
      type: 'object',
      topLevelKeys: Object.keys(payload).slice(0, 20),
    };
  }

  return {
    type: typeof payload,
    preview: String(payload).slice(0, 120),
  };
}

async function runTablePrecheck(entry) {
  const existsResult = await queryWithTimeout(
    `SELECT to_regclass($1) AS table_name`,
    [`public.${entry.table}`],
    { label: `validation.precheck.${entry.table}.exists`, timeoutMs: 15000, maxRetries: 1, retryDelayMs: 250 }
  );

  const exists = Boolean(existsResult.rows[0] && existsResult.rows[0].table_name);
  const columnsResult = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = ANY($2::text[])
     ORDER BY column_name ASC`,
    [entry.table, entry.columns],
    { label: `validation.precheck.${entry.table}.columns`, timeoutMs: 15000, maxRetries: 1, retryDelayMs: 250 }
  );

  const rowCountResult = await queryWithTimeout(
    `SELECT COALESCE(s.n_live_tup::bigint, c.reltuples::bigint, 0) AS row_count
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = $1`,
    [entry.table],
    { label: `validation.precheck.${entry.table}.count_estimate`, timeoutMs: 15000, maxRetries: 1, retryDelayMs: 250 }
  );

  const foundColumns = columnsResult.rows.map((row) => row.column_name);
  const missingColumns = entry.columns.filter((column) => !foundColumns.includes(column));

  return {
    table: entry.table,
    exists,
    expectedColumns: entry.columns,
    foundColumns,
    missingColumns,
    rowCount: Number(rowCountResult.rows[0] && rowCountResult.rows[0].row_count ? rowCountResult.rows[0].row_count : 0),
    ok: exists && missingColumns.length === 0,
  };
}

async function hitEndpoint(entry, iteration) {
  const startedAt = Date.now();
  try {
    const response = await fetch(entry.url, { signal: AbortSignal.timeout(25000) });
    const elapsedMs = Date.now() - startedAt;
    const raw = await response.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }

    return {
      iteration,
      status: response.status,
      ok: response.ok,
      elapsedMs,
      payloadSummary: summarizePayload(parsed),
    };
  } catch (error) {
    return {
      iteration,
      status: null,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: error.message,
    };
  }
}

async function validateEndpoint(entry) {
  const attempts = [];
  for (let index = 0; index < entry.repeats; index += 1) {
    attempts.push(await hitEndpoint(entry, index + 1));
  }

  return {
    name: entry.name,
    url: entry.url,
    repeats: entry.repeats,
    attempts,
    ok: attempts.every((attempt) => attempt.ok),
  };
}

async function main() {
  const startedAt = new Date().toISOString();

  const precheck = {
    startedAt,
    checks: [],
    ok: true,
  };

  for (const entry of tableChecks) {
    const result = await runTablePrecheck(entry);
    precheck.checks.push(result);
    if (!result.ok || result.rowCount <= 0) {
      precheck.ok = false;
    }
  }

  fs.writeFileSync(PRECHECK_PATH, JSON.stringify(precheck, null, 2));

  const endpointValidation = {
    startedAt,
    checks: [],
    ok: true,
  };

  for (const entry of endpoints) {
    const result = await validateEndpoint(entry);
    endpointValidation.checks.push(result);
    if (!result.ok) {
      endpointValidation.ok = false;
    }
  }

  fs.writeFileSync(ENDPOINT_PATH, JSON.stringify(endpointValidation, null, 2));

  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    schedulerFlags: {
      ENABLE_NON_ESSENTIAL_ENGINES: process.env.ENABLE_NON_ESSENTIAL_ENGINES ?? null,
      ENABLE_BACKGROUND_SERVICES: process.env.ENABLE_BACKGROUND_SERVICES ?? null,
      SAFE_MODE: process.env.SAFE_MODE ?? null,
    },
    precheckOk: precheck.ok,
    endpointValidationOk: endpointValidation.ok,
    touchedFiles: [
      'server/v2/index.js',
      'server/db/pool.js',
      'server/v2/services/snapshotService.js',
    ],
    summary: endpointValidation.checks.map((check) => ({
      name: check.name,
      ok: check.ok,
      statuses: check.attempts.map((attempt) => attempt.status),
      maxElapsedMs: Math.max(...check.attempts.map((attempt) => Number(attempt.elapsedMs || 0))),
    })),
  };

  report.result = report.precheckOk && report.endpointValidationOk
    ? 'BUILD VALIDATED - SAFE TO DEPLOY'
    : 'BUILD FAILED - FIX REQUIRED';

  fs.writeFileSync(BUILD_REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));

  if (report.result !== 'BUILD VALIDATED - SAFE TO DEPLOY') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const failed = {
    completedAt: new Date().toISOString(),
    error: error.message,
    result: 'BUILD FAILED - FIX REQUIRED',
  };
  fs.writeFileSync(BUILD_REPORT_PATH, JSON.stringify(failed, null, 2));
  console.error(error);
  process.exit(1);
});
