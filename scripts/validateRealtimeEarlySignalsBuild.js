const fs = require('fs');
const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', 'server', '.env'),
  override: true,
});

const { queryWithTimeout } = require('../server/db/pg');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const PRECHECK_LOG = path.join(LOG_DIR, 'precheck_validation.json');
const ENDPOINT_LOG = path.join(LOG_DIR, 'endpoint_validation.json');
const BUILD_LOG = path.join(LOG_DIR, 'build_validation_report.json');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

async function precheckPhase() {
  const [tableCheck, columnsCheck, tableCountCheck, sourceCountCheck] = await Promise.all([
    queryWithTimeout(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'early_signals'
       ) AS exists`,
      [],
      { label: 'validate.precheck.table_exists', timeoutMs: 3000, maxRetries: 0, poolType: 'read' }
    ),
    queryWithTimeout(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'early_signals'
       ORDER BY ordinal_position`,
      [],
      { label: 'validate.precheck.columns', timeoutMs: 3000, maxRetries: 0, poolType: 'read' }
    ),
    queryWithTimeout(
      `SELECT COUNT(*)::int AS count FROM early_signals`,
      [],
      { label: 'validate.precheck.early_signals_count', timeoutMs: 3000, maxRetries: 0, poolType: 'read' }
    ),
    queryWithTimeout(
      `SELECT COUNT(*)::int AS count FROM market_metrics`,
      [],
      { label: 'validate.precheck.market_metrics_count', timeoutMs: 3000, maxRetries: 0, poolType: 'read' }
    ),
  ]);

  const requiredColumns = [
    'id',
    'symbol',
    'signal_type',
    'signal_strength',
    'first_seen',
    'price_at_signal',
    'volume_at_signal',
  ];

  const presentColumns = new Set((columnsCheck.rows || []).map((row) => String(row.column_name || '')));
  const missingColumns = requiredColumns.filter((column) => !presentColumns.has(column));

  return {
    phase: 'phase_0_precheck',
    table_exists: Boolean(tableCheck.rows?.[0]?.exists),
    required_columns: requiredColumns,
    missing_columns: missingColumns,
    row_counts: {
      early_signals: Number(tableCountCheck.rows?.[0]?.count || 0),
      market_metrics: Number(sourceCountCheck.rows?.[0]?.count || 0),
    },
    pass: Boolean(tableCheck.rows?.[0]?.exists) && missingColumns.length === 0,
    validated_at: new Date().toISOString(),
  };
}

async function endpointPhase() {
  const baseUrl = String(process.env.VALIDATION_BASE_URL || 'http://127.0.0.1:3007');
  const targets = [
    '/api/screener',
    '/api/intelligence/decision/AAPL',
    '/api/intelligence/top-opportunities',
    '/api/market/overview',
    '/api/earnings',
  ];

  const results = [];

  for (const target of targets) {
    const url = `${baseUrl}${target}`;
    try {
      const response = await fetch(url, { method: 'GET' });
      let body = null;
      try {
        body = await response.json();
      } catch (_parseError) {
        body = null;
      }

      const hasExpectedShape = Boolean(body) && typeof body === 'object';

      results.push({
        endpoint: target,
        url,
        status: response.status,
        ok: response.status === 200 && hasExpectedShape,
      });
    } catch (error) {
      results.push({
        endpoint: target,
        url,
        status: null,
        ok: false,
        error: error.message,
      });
    }
  }

  const pass = results.every((result) => result.ok);

  return {
    phase: 'phase_4_endpoint_retest',
    base_url: baseUrl,
    results,
    pass,
    validated_at: new Date().toISOString(),
  };
}

async function run() {
  ensureLogDir();

  const precheck = await precheckPhase();
  writeJson(PRECHECK_LOG, precheck);

  const endpointValidation = await endpointPhase();
  writeJson(ENDPOINT_LOG, endpointValidation);

  const pass = precheck.pass && endpointValidation.pass;
  const report = {
    message: pass ? 'BUILD VALIDATED - SAFE TO DEPLOY' : 'BUILD FAILED - FIX REQUIRED',
    pass,
    phases: {
      phase_0_precheck: precheck,
      phase_4_endpoint_retest: endpointValidation,
    },
    generated_at: new Date().toISOString(),
  };

  writeJson(BUILD_LOG, report);

  console.log(JSON.stringify({
    message: report.message,
    pass: report.pass,
    precheck_pass: precheck.pass,
    endpoint_pass: endpointValidation.pass,
  }, null, 2));

  if (!pass) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('[VALIDATION ERROR]', error.message);
  process.exit(1);
});
