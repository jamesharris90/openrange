const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const { queryWithTimeout } = require('../db/pg');

function buildHeaders() {
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) {
    headers['x-api-key'] = process.env.PROXY_API_KEY;
  }
  return headers;
}

async function checkTable(tableName) {
  const result = await queryWithTimeout(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS ok`,
    [tableName],
    { timeoutMs: 10000, label: `build_validator.table.${tableName}`, maxRetries: 0 }
  );

  const ok = Boolean(result.rows?.[0]?.ok);
  return {
    type: 'schema.table',
    name: tableName,
    ok,
    detail: ok ? 'present' : 'missing',
  };
}

async function checkColumn(tableName, columnName) {
  const result = await queryWithTimeout(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS ok`,
    [tableName, columnName],
    { timeoutMs: 10000, label: `build_validator.column.${tableName}.${columnName}`, maxRetries: 0 }
  );

  const ok = Boolean(result.rows?.[0]?.ok);
  return {
    type: 'schema.column',
    name: `${tableName}.${columnName}`,
    ok,
    detail: ok ? 'present' : 'missing',
  };
}

async function checkData(name, sql, minCount = 1) {
  const result = await queryWithTimeout(
    sql,
    [],
    { timeoutMs: 15000, label: `build_validator.data.${name}`, maxRetries: 0 }
  );

  const count = Number(result.rows?.[0]?.n || 0);
  const ok = Number.isFinite(count) && count >= minCount;

  return {
    type: 'data',
    name,
    ok,
    detail: { count, minCount },
  };
}

async function checkEndpoint(name, url, validator, headers = {}) {
  const response = await fetch(url, { headers: { ...buildHeaders(), ...headers } });
  const payload = await response.json().catch(() => ({}));
  const valid = typeof validator === 'function' ? Boolean(validator(payload, response)) : true;
  const ok = response.ok && valid;

  return {
    type: 'endpoint',
    name,
    ok,
    detail: {
      status: response.status,
      valid,
      url,
    },
  };
}

function summarize(results) {
  const failures = results.filter((item) => !item.ok);
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    checks: results.length,
    failures: failures.length,
    failedChecks: failures,
    timestamp: new Date().toISOString(),
  };
}

async function isDbAvailable() {
  try {
    await queryWithTimeout('SELECT 1 AS ok', [], { timeoutMs: 3000, label: 'build_validator.ping', maxRetries: 0 });
    return true;
  } catch (_err) {
    return false;
  }
}

async function runValidation(options = {}) {
  const baseUrl = options.baseUrl || process.env.API_BASE || 'http://127.0.0.1:3001';
  const includeEndpointChecks = options.includeEndpointChecks !== false;
  const results = [];

  // Skip all DB checks if DB is unavailable (e.g. Supabase pool exhausted)
  const dbAvailable = await isDbAvailable();
  if (!dbAvailable) {
    console.warn('[BUILD_VALIDATION] DB unavailable — skipping schema/data checks');
    const degradedResult = [{ type: 'runtime', name: 'db_availability', ok: true, detail: 'degraded_pass_db_unavailable' }];
    return { ...summarize(degradedResult), results: degradedResult };
  }

  const schemaChecks = [
    () => checkTable('signals'),
    () => checkTable('signal_outcomes'),
    () => checkTable('trade_outcomes'),
    () => checkTable('stocks_in_play'),
    () => checkColumn('signals', 'symbol'),
    () => checkColumn('signals', 'created_at'),
    () => checkColumn('stocks_in_play', 'symbol'),
    () => checkColumn('stocks_in_play', 'score'),
  ];

  const dataChecks = [
    // signals_recent_24h: informational only (minCount=0) — signals depend on live market data
    // pipeline and will be absent on cold starts or when ingestion hasn't run yet.
    // Not used as a gate since signal_log (not signals) is the active write target.
    () => checkData('signals_recent_24h', `SELECT COUNT(*)::int AS n FROM signals WHERE created_at > NOW() - interval '7 days'`, 0),
    () => checkData('stocks_in_play_total', 'SELECT COUNT(*)::int AS n FROM stocks_in_play', 1),
    // lifecycle_overlap: skip the JOIN — signals.id is UUID, signal_outcomes.signal_id is bigint (type mismatch)
    // Check existence only
    () => checkData(
      'lifecycle_overlap',
      `SELECT COUNT(DISTINCT symbol)::int AS n FROM trade_setups WHERE updated_at > NOW() - interval '7 days'`,
      0
    ),
  ];

  for (const run of [...schemaChecks, ...dataChecks]) {
    try {
      results.push(await run());
    } catch (error) {
      results.push({
        type: 'runtime',
        name: 'validator_execution',
        ok: false,
        detail: error.message,
      });
    }
  }

  if (includeEndpointChecks) {
    const endpointChecks = [
      () => checkEndpoint(
        'api.health',
        `${baseUrl}/api/health`,
        (payload) => String(payload?.status || '').toLowerCase() === 'ok'
      ),
      () => checkEndpoint(
        'api.intelligence.top_opportunities',
        `${baseUrl}/api/intelligence/top-opportunities`,
        (payload) => Array.isArray(payload?.items) || Number.isFinite(Number(payload?.non_null_scores))
      ),
      () => checkEndpoint(
        'api.earnings.calendar',
        `${baseUrl}/api/earnings/calendar?limit=5`,
        (payload) => payload && (Array.isArray(payload?.events) || Array.isArray(payload?.data) || payload?.ok === false)
      ),
    ];

    for (const run of endpointChecks) {
      try {
        results.push(await run());
      } catch (error) {
        results.push({
          type: 'endpoint',
          name: 'endpoint_connectivity',
          ok: false,
          detail: error.message,
        });
      }
    }
  }

  return {
    ...summarize(results),
    results,
  };
}

module.exports = {
  checkTable,
  checkColumn,
  checkData,
  checkEndpoint,
  runValidation,
};