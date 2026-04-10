const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = '/Users/jamesharris/Server';
const ENV_PATH = path.join(ROOT, 'server', '.env');
const PRECHECK_LOG_PATH = path.join(ROOT, 'logs', 'precheck_validation.json');
const ENDPOINT_LOG_PATH = path.join(ROOT, 'logs', 'endpoint_validation.json');
const REPORT_PATH = path.join(ROOT, 'SCREENER_CLEAN_MODE_REPORT.json');

const PRECHECK_TABLES = {
  market_quotes: ['symbol', 'price', 'change_percent', 'volume', 'relative_volume', 'sector', 'updated_at'],
  market_metrics: ['symbol', 'price', 'change_percent', 'volume', 'gap_percent', 'relative_volume', 'updated_at', 'last_updated', 'vwap'],
  stocks_in_play: ['symbol', 'gap_percent', 'rvol', 'detected_at'],
  ticker_universe: ['symbol', 'sector'],
  intraday_1m: ['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume', 'session'],
  daily_ohlc: ['symbol', 'date', 'close'],
  earnings_events: ['symbol', 'report_date', 'earnings_date'],
  news_articles: ['symbol', 'headline', 'published_at', 'source_type'],
  screener_snapshots: ['data', 'created_at'],
};

const API_BASE_URL = 'http://127.0.0.1:3007';

const ENDPOINTS = [
  `${API_BASE_URL}/api/screener`,
  `${API_BASE_URL}/api/intelligence/decision/AAPL`,
  `${API_BASE_URL}/api/intelligence/top-opportunities?limit=5`,
  `${API_BASE_URL}/api/market/overview`,
  `${API_BASE_URL}/api/earnings?limit=5`,
];

function readEnvFile(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && line[0] !== '#' && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

async function buildPrecheckReport(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const tableNames = Object.keys(PRECHECK_TABLES);
    const [tableResult, columnResult] = await Promise.all([
      client.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
         ORDER BY table_name`,
        [tableNames]
      ),
      client.query(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
         ORDER BY table_name, column_name`,
        [tableNames]
      ),
    ]);

    const existingTables = new Set(tableResult.rows.map((row) => row.table_name));
    const columnsByTable = new Map();
    for (const row of columnResult.rows) {
      if (!columnsByTable.has(row.table_name)) {
        columnsByTable.set(row.table_name, new Set());
      }
      columnsByTable.get(row.table_name).add(row.column_name);
    }

    const report = {
      generated_at: new Date().toISOString(),
      tables: {},
    };

    for (const tableName of tableNames) {
      const countResult = existingTables.has(tableName)
        ? await client.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`)
        : { rows: [{ count: 0 }] };
      const availableColumns = columnsByTable.get(tableName) || new Set();
      report.tables[tableName] = {
        exists: existingTables.has(tableName),
        row_count: countResult.rows[0]?.count ?? 0,
        required_columns: PRECHECK_TABLES[tableName].map((columnName) => ({
          name: columnName,
          exists: availableColumns.has(columnName),
        })),
      };
    }

    return report;
  } finally {
    await client.end();
  }
}

async function fetchEndpoint(url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch (_error) {
      body = null;
    }

    const entry = {
      url,
      status: response.status,
      ok: response.ok,
      response_ms: Date.now() - startedAt,
      body_type: Array.isArray(body) ? 'array' : typeof body,
      keys: body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [],
    };

    if (url.includes('/api/screener') && body && typeof body === 'object') {
      entry.row_count = Array.isArray(body.data) ? body.data.length : 0;
      entry.meta = body.meta || null;
      entry.sample_sort = Array.isArray(body.data)
        ? body.data.slice(0, 5).map((row) => ({
            symbol: row.symbol || null,
            volume: row.volume ?? null,
            change_percent: row.change_percent ?? null,
            rvol: row.rvol ?? null,
            final_score: row.final_score ?? null,
          }))
        : [];
    }

    return entry;
  } catch (error) {
    return {
      url,
      status: 0,
      ok: false,
      response_ms: Date.now() - startedAt,
      error: error.message,
    };
  }
}

async function buildEndpointReport() {
  const endpoints = [];
  for (const url of ENDPOINTS) {
    endpoints.push(await fetchEndpoint(url));
  }
  return {
    generated_at: new Date().toISOString(),
    endpoints,
  };
}

function buildCleanModeReport(precheckReport, endpointReport) {
  const screenerEntry = endpointReport.endpoints.find((entry) => entry.url.endsWith('/api/screener')) || null;
  return {
    generated_at: new Date().toISOString(),
    removed_columns: ['strategyScore', 'catalystScore', 'avg_score_summary'],
    removed_sorting: ['strategyScore', 'catalystScore', 'final_score', 'tqi'],
    backend_order_updated: {
      endpoint: '/api/screener',
      order: ['volume desc', 'abs(change_percent) desc', 'rvol desc', 'symbol asc'],
    },
    filters_preserved: ['ORB Scanner', 'Gap filters', 'Momentum filters', 'Earnings filters', 'Technical filters'],
    backend_score_fields_preserved_for_other_pages: ['tqi', 'tqi_label', 'final_score', 'coverage_score', 'data_confidence'],
    total_rows_returned: screenerEntry?.row_count ?? null,
    screener_meta: screenerEntry?.meta ?? null,
    precheck_tables: Object.fromEntries(
      Object.entries(precheckReport.tables).map(([tableName, value]) => [tableName, {
        exists: value.exists,
        row_count: value.row_count,
      }])
    ),
  };
}

async function main() {
  const env = readEnvFile(ENV_PATH);
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });

  const precheckReport = await buildPrecheckReport(env.DATABASE_URL);
  fs.writeFileSync(PRECHECK_LOG_PATH, JSON.stringify(precheckReport, null, 2));

  const endpointReport = await buildEndpointReport();
  fs.writeFileSync(ENDPOINT_LOG_PATH, JSON.stringify(endpointReport, null, 2));

  const cleanModeReport = buildCleanModeReport(precheckReport, endpointReport);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(cleanModeReport, null, 2));

  const screenerEndpoint = endpointReport.endpoints.find((entry) => entry.url.endsWith('/api/screener'));
  const allEndpointsHealthy = endpointReport.endpoints.every((entry) => entry.ok || entry.status === 200);
  const allColumnsPresent = Object.values(precheckReport.tables).every((table) => table.exists && table.required_columns.every((column) => column.exists));
  const buildPassed = Boolean(allEndpointsHealthy && allColumnsPresent && screenerEndpoint?.row_count > 0);

  console.log(buildPassed ? 'BUILD VALIDATED - SAFE TO DEPLOY' : 'BUILD FAILED - FIX REQUIRED');
  console.log(JSON.stringify({
    screener_rows: screenerEndpoint?.row_count ?? 0,
    precheck_log: PRECHECK_LOG_PATH,
    endpoint_log: ENDPOINT_LOG_PATH,
    report: REPORT_PATH,
  }, null, 2));

  if (!buildPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});