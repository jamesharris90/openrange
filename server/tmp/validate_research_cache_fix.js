const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const { queryWithTimeout } = require('../db/pg');

const BASE_URL = process.env.VALIDATION_BASE_URL || 'http://127.0.0.1:3001';
const LOG_DIR = path.resolve(__dirname, '../../logs');
const PRECHECK_LOG = path.join(LOG_DIR, 'precheck_validation.json');
const ENDPOINT_LOG = path.join(LOG_DIR, 'endpoint_validation.json');
const BUILD_LOG = path.join(LOG_DIR, 'build_validation_report.json');

async function fetchJson(endpoint) {
  const startedAt = Date.now();
  const response = await fetch(`${BASE_URL}${endpoint}`);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_error) {
    body = { raw: text };
  }

  return {
    endpoint,
    status: response.status,
    ok: response.ok,
    elapsed_ms: Date.now() - startedAt,
    body,
  };
}

async function readTableInfo(table, columns, symbolColumn) {
  const symbolCountTimeoutMs = 30000;
  const existsResult = await queryWithTimeout(
    'SELECT to_regclass($1) AS name',
    [`public.${table}`],
    { timeoutMs: 5000, label: `validation.exists.${table}`, maxRetries: 0 },
  );
  const exists = Boolean(existsResult.rows?.[0]?.name);

  const columnSet = new Set();
  if (exists) {
    const columnResult = await queryWithTimeout(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [table],
      { timeoutMs: 5000, label: `validation.columns.${table}`, maxRetries: 0 },
    );
    for (const row of columnResult.rows || []) {
      columnSet.add(row.column_name);
    }
  }

  const symbolCounts = symbolColumn && exists
    ? await queryWithTimeout(
      `SELECT ${symbolColumn} AS symbol, COUNT(*)::bigint AS count
       FROM ${table}
       WHERE ${symbolColumn} = ANY($1::text[])
       GROUP BY ${symbolColumn}`,
      [['AAPL', 'INTC', 'NVDA']],
      { timeoutMs: symbolCountTimeoutMs, label: `validation.symbol_counts.${table}`, maxRetries: 0 },
    )
    : { rows: [] };

  return {
    table,
    exists,
    columns: Object.fromEntries(columns.map((column) => [column, columnSet.has(column)])),
    symbol_counts: Object.fromEntries(
      ['AAPL', 'INTC', 'NVDA'].map((symbol) => {
        const row = (symbolCounts.rows || []).find((entry) => entry.symbol === symbol);
        return [symbol, Number(row?.count || 0)];
      }),
    ),
  };
}

async function buildPrecheckReport() {
  const tables = [];
  tables.push(await readTableInfo('news_articles', ['id', 'symbol', 'headline', 'published_at'], 'symbol'));
  tables.push(await readTableInfo('earnings_history', ['symbol', 'report_date', 'eps_actual', 'eps_estimate'], 'symbol'));
  tables.push(await readTableInfo('daily_ohlcv', ['symbol', 'date', 'close'], 'symbol'));
  tables.push(await readTableInfo('data_coverage', ['symbol', 'coverage_score', 'has_news', 'has_earnings', 'has_technicals'], 'symbol'));

  const ok = tables.every((table) => table.exists && Object.values(table.columns).every(Boolean));
  const report = {
    ok,
    checked_at: new Date().toISOString(),
    tables,
  };

  fs.writeFileSync(PRECHECK_LOG, JSON.stringify(report, null, 2) + '\n');
  return report;
}

function extractCoverage(body) {
  return body?.data?.coverage || body?.coverage || {};
}

async function buildEndpointReport() {
  const health = await fetchJson('/api/health');
  const screener = await fetchJson('/api/screener');
  const decision = await fetchJson('/api/intelligence/decision/AAPL');
  const opportunities = await fetchJson('/api/intelligence/top-opportunities?limit=5');
  const marketOverview = await fetchJson('/api/market/overview');
  const earningsCalendar = await fetchJson('/api/earnings/calendar');
  const shortAapl = await fetchJson('/api/research/AAPL');

  const repeatedIntcFull = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetchJson('/api/research/INTC/full');
    repeatedIntcFull.push({
      attempt,
      status: response.status,
      elapsed_ms: response.elapsed_ms,
      coverage_score: Number(extractCoverage(response.body).coverage_score || extractCoverage(response.body).score || 0),
      news_count: Number(extractCoverage(response.body).news_count || 0),
      degraded_sections: response.body?.meta?.degraded_sections || [],
      partial: Boolean(response.body?.meta?.partial),
    });
  }

  const intcPass = repeatedIntcFull.every((entry) => entry.status === 200 && entry.coverage_score === 100 && entry.news_count > 0);
  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    pass: Boolean(
      health.status === 200
      && screener.status === 200
      && decision.status === 200
      && opportunities.status === 200
      && marketOverview.status === 200
      && earningsCalendar.status === 200
      && shortAapl.status === 200
      && intcPass
    ),
    endpoints: {
      health: { status: health.status, scheduler_flags: health.body?.scheduler_flags || null },
      screener: { status: screener.status, count: Array.isArray(screener.body?.data) ? screener.body.data.length : null },
      decision_aapl: { status: decision.status, source: decision.body?.source || null, ok: Boolean(decision.body?.ok) },
      top_opportunities: { status: opportunities.status, count: Number(opportunities.body?.count || 0) },
      market_overview: { status: marketOverview.status, status_field: marketOverview.body?.status || null },
      earnings_calendar: { status: earningsCalendar.status, count: Number(earningsCalendar.body?.count || 0) },
      research_aapl: {
        status: shortAapl.status,
        coverage_score: Number(extractCoverage(shortAapl.body).coverage_score || 0),
        news_count: Number(extractCoverage(shortAapl.body).news_count || 0),
        earnings_count: Number(extractCoverage(shortAapl.body).earnings_count || 0),
      },
      research_intc_full_repeated: repeatedIntcFull,
    },
  };

  fs.writeFileSync(ENDPOINT_LOG, JSON.stringify(report, null, 2) + '\n');
  return report;
}

function buildBuildReport(precheck, endpointValidation) {
  const pass = Boolean(precheck.ok && endpointValidation.pass);
  const report = {
    generated_at: new Date().toISOString(),
    status: pass ? 'BUILD VALIDATED - SAFE TO DEPLOY' : 'BUILD FAILED - FIX REQUIRED',
    precheck: {
      pass: precheck.ok,
      log: 'logs/precheck_validation.json',
    },
    backend: {
      endpoint_validation: {
        pass: endpointValidation.pass,
        log: 'logs/endpoint_validation.json',
      },
      repeated_full_route_acceptance: endpointValidation.endpoints.research_intc_full_repeated,
    },
    required_message: pass ? 'BUILD VALIDATED - SAFE TO DEPLOY' : 'BUILD FAILED - FIX REQUIRED',
  };

  fs.writeFileSync(BUILD_LOG, JSON.stringify(report, null, 2) + '\n');
  return report;
}

async function main() {
  const precheck = await buildPrecheckReport();
  const endpointValidation = await buildEndpointReport();
  const buildReport = buildBuildReport(precheck, endpointValidation);

  console.log(JSON.stringify({ precheck, endpointValidation, buildReport }, null, 2));

  if (!buildReport.status.includes('SAFE TO DEPLOY')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});