const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { queryWithTimeout } = require('../db/pg');

async function tableCheck(table, columns) {
  const existsRes = await queryWithTimeout(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1
    ) AS exists`,
    [table],
    { timeoutMs: 3000, label: `validate.precheck.table.${table}`, maxRetries: 0 }
  ).catch(() => ({ rows: [{ exists: false }] }));

  const exists = Boolean(existsRes.rows?.[0]?.exists);
  let rowCount = null;
  if (exists) {
    const countRes = await queryWithTimeout(
      `SELECT COUNT(*)::bigint AS c FROM ${table}`,
      [],
      { timeoutMs: 3000, label: `validate.precheck.count.${table}`, maxRetries: 0 }
    ).catch(() => ({ rows: [{ c: null }] }));
    rowCount = countRes.rows?.[0]?.c ?? null;
  }

  const colRes = await queryWithTimeout(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table],
    { timeoutMs: 3000, label: `validate.precheck.columns.${table}`, maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const present = new Set((colRes.rows || []).map((row) => row.column_name));
  const missingColumns = (columns || []).filter((column) => !present.has(column));

  return {
    table,
    exists,
    rowCount,
    missingColumns,
    ok: exists && missingColumns.length === 0,
  };
}

async function endpoint(baseUrl, pathname, method = 'GET') {
  const response = await fetch(`${baseUrl}${pathname}`, { method });
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  return {
    endpoint: pathname,
    status: response.status,
    ok: response.status === 200,
    count: body?.count ?? (Array.isArray(body?.data) ? body.data.length : null),
    body,
  };
}

async function main() {
  const outDir = path.resolve(__dirname, '../../logs');
  fs.mkdirSync(outDir, { recursive: true });

  const precheck = {
    generated_at: new Date().toISOString(),
    checks: [
      await tableCheck('news_catalysts', ['symbol', 'catalyst_type', 'headline', 'published_at']),
      await tableCheck('earnings_events', ['symbol', 'earnings_date', 'updated_at']),
      await tableCheck('trade_signals', ['symbol', 'score', 'updated_at']),
      await tableCheck('market_quotes', ['symbol']),
    ],
  };
  precheck.ok = precheck.checks.every((check) => check.ok);

  const baseUrl = process.env.RUNTIME_BASE_URL || 'http://localhost:3001';
  const runAll = await endpoint(baseUrl, '/api/cron/run-all', 'POST');
  const checks = await Promise.all([
    endpoint(baseUrl, '/api/screener'),
    endpoint(baseUrl, '/api/intelligence/decision'),
    endpoint(baseUrl, '/api/intelligence/top-opportunities'),
    endpoint(baseUrl, '/api/market/overview'),
    endpoint(baseUrl, '/api/earnings'),
    endpoint(baseUrl, '/api/stocks-in-play'),
  ]);

  const endpointValidation = {
    generated_at: new Date().toISOString(),
    run_all: {
      status: runAll.status,
      success: Boolean(runAll.body?.success),
      runs: runAll.body?.runs || [],
    },
    checks: checks.map((result) => ({
      endpoint: result.endpoint,
      status: result.status,
      ok: result.ok,
      count: result.count,
    })),
  };
  endpointValidation.ok = endpointValidation.run_all.success && endpointValidation.checks.every((check) => check.ok);

  const buildValidation = {
    generated_at: new Date().toISOString(),
    precheck_ok: precheck.ok,
    endpoint_ok: endpointValidation.ok,
    run_all_success: endpointValidation.run_all.success,
    final_status: precheck.ok && endpointValidation.ok
      ? 'BUILD VALIDATED - SAFE TO DEPLOY'
      : 'BUILD FAILED - FIX REQUIRED',
  };

  fs.writeFileSync(path.join(outDir, 'precheck_validation.json'), JSON.stringify(precheck, null, 2));
  fs.writeFileSync(path.join(outDir, 'endpoint_validation.json'), JSON.stringify(endpointValidation, null, 2));
  fs.writeFileSync(path.join(outDir, 'build_validation_report.json'), JSON.stringify(buildValidation, null, 2));

  console.log(JSON.stringify(buildValidation, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
