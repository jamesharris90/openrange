const path = require('path');
const fs = require('fs').promises;
const { queryWithTimeout } = require('../db/pg');
const marketService = require('./marketDataService');
const { fmpFetch } = require('./fmpClient');
const { runIngestionNow } = require('../engines/scheduler');
const { runAllIngestions } = require('../ingestion/run_all_ingest');
const { mapToProviderSymbol } = require('../utils/symbolMap');

const SCHEMA_REPORT_PATH = path.resolve(__dirname, '../../docs/data-schema-report.json');
const PIPELINE_REPORT_PATH = path.resolve(__dirname, '../../docs/data-pipeline-report.json');

const PARITY_SYMBOLS = ['AAPL', 'SPY'];

const TABLE_FRESHNESS_MINUTES = {
  market_quotes: 45,
  intraday_1m: 30,
  daily_ohlc: 7 * 24 * 60,
  trade_setups: 24 * 60,
  strategy_signals: 24 * 60,
  news_catalysts: 24 * 60,
  catalyst_intelligence: 24 * 60,
  catalyst_reactions: 24 * 60,
};

const REQUIRED_FIELDS = {
  market_quotes: ['symbol', 'price', 'volume', 'updated_at'],
  intraday_1m: ['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume'],
  trade_setups: ['symbol', 'setup_type', 'score', 'detected_at'],
  strategy_signals: ['symbol', 'strategy', 'score', 'created_at'],
};

const QUALITY_WINDOWS = {
  market_quotes: "updated_at > NOW() - INTERVAL '3 days'",
  intraday_1m: "timestamp > NOW() - INTERVAL '3 days'",
  trade_setups: "COALESCE(detected_at, updated_at) > NOW() - INTERVAL '14 days'",
  strategy_signals: "COALESCE(updated_at, created_at) > NOW() - INTERVAL '14 days'",
};

const RECOVERY_RETRY_DELAYS_MS = [300, 900, 2000];
const STALE_FALLBACK_SYMBOLS = ['AAPL', 'SPY', 'QQQ', 'IWM'];
const INGESTION_FAILURE_TABLES = new Set([
  'market_quotes',
  'intraday_1m',
  'daily_ohlc',
  'trade_setups',
  'strategy_signals',
  'news_catalysts',
  'catalyst_intelligence',
  'catalyst_reactions',
]);

const INVALID_ROW_CONDITIONS = {
  market_quotes: `price IS NULL OR price <= 0 OR volume IS NULL OR volume < 0 OR symbol IS NULL OR NULLIF(BTRIM(symbol), '') IS NULL`,
  intraday_1m: `symbol IS NULL OR NULLIF(BTRIM(symbol), '') IS NULL OR open IS NULL OR high IS NULL OR low IS NULL OR close IS NULL OR close <= 0 OR volume IS NULL OR volume < 0`,
  trade_setups: `symbol IS NULL OR NULLIF(BTRIM(symbol), '') IS NULL OR score IS NULL OR score < 0`,
  strategy_signals: `symbol IS NULL OR NULLIF(BTRIM(symbol), '') IS NULL OR score IS NULL OR score < 0`,
};

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

async function readJsonFile(filePath, fallback = {}) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return safeJsonParse(content, fallback);
  } catch (_error) {
    return fallback;
  }
}

function isSafeIdentifier(identifier) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(identifier || ''));
}

function toMillis(value) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function lagMinutesFromNow(timestamp) {
  const ts = toMillis(timestamp);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (Date.now() - ts) / 60000);
}

function inferFreshnessThresholdMinutes(tableName) {
  if (TABLE_FRESHNESS_MINUTES[tableName]) return TABLE_FRESHNESS_MINUTES[tableName];
  if (tableName.includes('intraday')) return 30;
  if (tableName.includes('quote')) return 45;
  if (tableName.includes('daily')) return 7 * 24 * 60;
  return 24 * 60;
}

function severityToLevel(severity) {
  const value = String(severity || '').toLowerCase();
  if (value === 'critical') return 3;
  if (value === 'warning') return 2;
  return 1;
}

function classifyIssue(issue) {
  const issueType = String(issue?.type || '').toLowerCase();
  const key = String(issue?.key || '').toLowerCase();
  const message = String(issue?.message || '').toLowerCase();
  const table = String(issue?.table || '').toLowerCase();

  if (
    issueType === 'pipeline_health'
    || key.includes('pipeline')
    || key.includes('missing_url')
    || key.includes('endpoint')
    || message.includes('endpoint')
    || message.includes('unreachable')
  ) {
    return 'endpoint_failure';
  }

  if (
    key.includes('nulls:')
    || key.includes('missing_column')
    || issueType === 'data_quality'
    || message.includes('critical field')
    || message.includes('missing on')
  ) {
    return 'data_quality_failure';
  }

  if (
    key.includes('freshness:')
    || message.includes('stale')
    || (issueType === 'database_health' && key.includes('freshness'))
  ) {
    return 'stale_data';
  }

  if (
    key.includes('rows:')
    || (issueType === 'database_health' && INGESTION_FAILURE_TABLES.has(table))
    || message.includes('has no rows')
  ) {
    return 'ingestion_failure';
  }

  return 'endpoint_failure';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff(task, delaysMs = RECOVERY_RETRY_DELAYS_MS) {
  const attempts = [];
  const allDelays = [0, ...delaysMs];

  for (let index = 0; index < allDelays.length; index += 1) {
    const delay = allDelays[index];
    if (delay > 0) {
      await sleep(delay);
    }

    try {
      const result = await task(index + 1);
      attempts.push({ attempt: index + 1, ok: true, delay_ms: delay, result });
      return { ok: true, attempts, result };
    } catch (error) {
      attempts.push({ attempt: index + 1, ok: false, delay_ms: delay, error: error.message });
    }
  }

  return { ok: false, attempts, result: null };
}

function logRecoveryAction(entry) {
  const logPayload = {
    type: entry.type,
    result: entry.result,
    duration_ms: entry.duration_ms,
    detail: entry.detail,
  };
  console.error('RECOVERY ACTION:', logPayload);
}

async function executeRecoveryAction(type, handler) {
  const started = Date.now();
  try {
    const detail = await handler();
    const action = {
      type,
      result: 'success',
      duration_ms: Date.now() - started,
      detail,
    };
    logRecoveryAction(action);
    return action;
  } catch (error) {
    const action = {
      type,
      result: 'failed',
      duration_ms: Date.now() - started,
      detail: { error: error.message },
    };
    logRecoveryAction(action);
    return action;
  }
}

async function recoverIngestionFailure(issues) {
  const affectedTables = Array.from(new Set(
    issues
      .filter((issue) => issue.classification === 'ingestion_failure')
      .map((issue) => String(issue.table || '').trim())
      .filter(Boolean)
  ));

  const ingestionRetry = await retryWithBackoff(async () => {
    const result = await runIngestionNow();
    return { mode: 'runIngestionNow', has_result: Boolean(result) };
  });

  if (ingestionRetry.ok) {
    return {
      affected_tables: affectedTables,
      runner: 'runIngestionNow',
      attempts: ingestionRetry.attempts,
    };
  }

  const fullJobRetry = await retryWithBackoff(async () => {
    const result = await runAllIngestions();
    return {
      mode: 'runAllIngestions',
      jobs: Array.isArray(result) ? result.map((job) => ({ job: job.job, ok: Boolean(job.ok) })) : [],
    };
  });

  if (!fullJobRetry.ok) {
    throw new Error('Failed to trigger ingestion recovery after retries');
  }

  return {
    affected_tables: affectedTables,
    runner: 'runAllIngestions',
    fallback_attempts: fullJobRetry.attempts,
  };
}

async function recoverStaleData(issues) {
  const staleTables = Array.from(new Set(
    issues
      .filter((issue) => issue.classification === 'stale_data')
      .map((issue) => String(issue.table || '').trim())
      .filter(Boolean)
  ));

  const fallbackSnapshots = [];

  if (staleTables.includes('market_quotes')) {
    const quoteRows = await marketService.getQuotes(STALE_FALLBACK_SYMBOLS);
    fallbackSnapshots.push({ dataset: 'quotes', symbols: STALE_FALLBACK_SYMBOLS, count: Array.isArray(quoteRows) ? quoteRows.length : 0 });
  }

  if (staleTables.includes('intraday_1m')) {
    const symbol = STALE_FALLBACK_SYMBOLS[0];
    const providerSymbol = mapToProviderSymbol(symbol);
    let intradayRows = [];

    try {
      intradayRows = await fmpFetch('/historical-chart/1min', { symbol: providerSymbol });
    } catch (_error) {
      const historical = await marketService.getHistorical(symbol, { interval: '1m', range: '1d' });
      intradayRows = Array.isArray(historical?.quotes) ? historical.quotes : [];
    }

    fallbackSnapshots.push({ dataset: 'intraday_1m', symbol, count: Array.isArray(intradayRows) ? intradayRows.length : 0 });
  }

  if (fallbackSnapshots.length === 0) {
    fallbackSnapshots.push({ dataset: 'none', reason: 'no stale table with fallback adapter' });
  }

  const recoveredAny = fallbackSnapshots.some((snapshot) => Number(snapshot.count || 0) > 0);
  if (!recoveredAny && fallbackSnapshots.every((snapshot) => snapshot.dataset !== 'none')) {
    throw new Error('Fallback live data fetch returned no rows for stale datasets');
  }

  return {
    stale_tables: staleTables,
    snapshots: fallbackSnapshots,
  };
}

async function recoverEndpointFailure(issues) {
  const endpointIssues = issues.filter((issue) => issue.classification === 'endpoint_failure' && issue.url);
  const results = [];

  for (const issue of endpointIssues) {
    const retryResult = await retryWithBackoff(async () => {
      const response = await safeFetchJson(issue.url);
      const rows = extractRows(response.payload);
      if (!response.ok || rows.length === 0) {
        throw new Error(`endpoint check failed status=${response.status} rows=${rows.length}`);
      }

      return {
        status: response.status,
        rows: rows.length,
      };
    });

    results.push({
      url: issue.url,
      pipeline: issue.pipeline || null,
      endpoint_type: issue.endpoint_type || null,
      recovered: retryResult.ok,
      attempts: retryResult.attempts,
    });
  }

  return {
    retried_endpoints: results.length,
    results,
  };
}

async function recoverDataQualityFailure(issues) {
  const tables = Array.from(new Set(
    issues
      .filter((issue) => issue.classification === 'data_quality_failure')
      .map((issue) => String(issue.table || '').trim())
      .filter(Boolean)
  ));

  const exclusions = [];

  for (const table of tables) {
    if (!isSafeIdentifier(table) || !INVALID_ROW_CONDITIONS[table]) continue;

    const invalidRowsQuery = await queryWithTimeout(
      `SELECT
         COUNT(*)::int AS invalid_count,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT symbol), NULL) AS symbols
       FROM ${table}
       WHERE ${INVALID_ROW_CONDITIONS[table]}`,
      [],
      { timeoutMs: 3500, maxRetries: 0, label: 'integrity.recovery.data_quality.exclude' }
    );

    const invalidCount = Number(invalidRowsQuery.rows?.[0]?.invalid_count || 0);
    const symbols = Array.isArray(invalidRowsQuery.rows?.[0]?.symbols)
      ? invalidRowsQuery.rows[0].symbols.filter(Boolean).map((item) => String(item).toUpperCase())
      : [];

    exclusions.push({
      table,
      excluded_rows: invalidCount,
      symbols: symbols.slice(0, 100),
      mode: 'runtime_filter',
    });
  }

  return {
    tables,
    exclusions,
  };
}

async function runRecoveryEngine(issues) {
  const actions = [];
  const classifications = new Set(issues.map((issue) => issue.classification));

  if (classifications.has('ingestion_failure')) {
    actions.push(await executeRecoveryAction('ingestion_failure', () => recoverIngestionFailure(issues)));
  }

  if (classifications.has('stale_data')) {
    actions.push(await executeRecoveryAction('stale_data', () => recoverStaleData(issues)));
  }

  if (classifications.has('endpoint_failure')) {
    actions.push(await executeRecoveryAction('endpoint_failure', () => recoverEndpointFailure(issues)));
  }

  if (classifications.has('data_quality_failure')) {
    actions.push(await executeRecoveryAction('data_quality_failure', () => recoverDataQualityFailure(issues)));
  }

  const exclusions = actions
    .filter((action) => action.type === 'data_quality_failure' && action.result === 'success')
    .flatMap((action) => Array.isArray(action.detail?.exclusions) ? action.detail.exclusions : []);

  return {
    actions,
    exclusions,
  };
}

function summarizeStatus(issues) {
  const maxLevel = issues.reduce((max, issue) => Math.max(max, severityToLevel(issue.severity)), 0);
  if (maxLevel >= 3) return 'down';
  if (maxLevel >= 2) return 'degraded';
  return 'ok';
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const root = payload;
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.items)) return root.items;

  if (root.data && typeof root.data === 'object') {
    if (Array.isArray(root.data.data)) return root.data.data;
    if (Array.isArray(root.data.items)) return root.data.items;
    if (Array.isArray(root.data.earnings)) return root.data.earnings;
  }

  if (Array.isArray(root.earnings)) return root.earnings;

  return [];
}

function findQuoteRows(payload) {
  const rows = extractRows(payload);
  return rows.filter((row) => row && typeof row === 'object' && row.symbol);
}

async function safeFetchJson(url) {
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) {
    headers['x-api-key'] = process.env.PROXY_API_KEY;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });

  const body = await response.text();
  const payload = safeJsonParse(body, {});

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function checkTableFieldExists(tableName, columnName) {
  const { rows } = await queryWithTimeout(
    `SELECT COUNT(*)::int AS count
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2`,
    [tableName, columnName],
    { timeoutMs: 2500, maxRetries: 0, label: 'integrity.field.exists' }
  );

  return Number(rows?.[0]?.count || 0) > 0;
}

async function getNullCount(tableName, columnName, windowClause = null) {
  const filters = [];
  if (windowClause) {
    filters.push(`(${windowClause})`);
  }

  filters.push(
    `${columnName} IS NULL
     OR (pg_typeof(${columnName})::text IN ('text', 'character varying') AND NULLIF(BTRIM(${columnName}::text), '') IS NULL)`
  );

  const sql = `SELECT COUNT(*)::int AS c
               FROM ${tableName}
               WHERE ${filters.join(' AND ')}`;

  const { rows } = await queryWithTimeout(
    sql,
    [],
    { timeoutMs: 3000, maxRetries: 0, label: 'integrity.field.null_count' }
  );

  return Number(rows?.[0]?.c || 0);
}

async function runDataIntegrityMonitor() {
  const issues = [];
  const tableStatuses = [];
  const dataQuality = [];
  const pipelineStatuses = [];

  const schemaReport = await readJsonFile(SCHEMA_REPORT_PATH, { table_inventory: [] });
  const pipelineReport = await readJsonFile(PIPELINE_REPORT_PATH, { pipelines: [] });

  const authoritativeTables = (schemaReport.table_inventory || []).filter((entry) => {
    const tableName = String(entry?.table || '');
    return Boolean(tableName) && !['opportunities'].includes(tableName);
  });

  for (const table of authoritativeTables) {
    const tableName = String(table.table || '');
    const rowCount = Number(table?.evidence?.row_count || 0);
    const latestTimestamp = table?.evidence?.latest_timestamp || null;
    const thresholdMinutes = inferFreshnessThresholdMinutes(tableName);
    const lagMinutes = lagMinutesFromNow(latestTimestamp);

    const hasRows = rowCount > 0;
    const isFresh = lagMinutes === null ? false : lagMinutes <= thresholdMinutes;

    const status = !hasRows ? 'down' : isFresh ? 'ok' : 'degraded';

    tableStatuses.push({
      table: tableName,
      row_count: rowCount,
      latest_timestamp: latestTimestamp,
      lag_minutes: lagMinutes,
      freshness_threshold_minutes: thresholdMinutes,
      status,
    });

    if (!hasRows) {
      issues.push({
        severity: 'critical',
        type: 'database_health',
        classification: 'ingestion_failure',
        key: `rows:${tableName}`,
        message: `Authoritative table ${tableName} has no rows`,
        table: tableName,
      });
    } else if (!isFresh) {
      issues.push({
        severity: 'warning',
        type: 'database_health',
        classification: 'stale_data',
        key: `freshness:${tableName}`,
        message: `Authoritative table ${tableName} is stale`,
        table: tableName,
        lag_minutes: lagMinutes,
        threshold_minutes: thresholdMinutes,
      });
    }
  }

  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_FIELDS)) {
    if (!isSafeIdentifier(tableName)) continue;

    for (const columnName of requiredColumns) {
      if (!isSafeIdentifier(columnName)) continue;

      const columnExists = await checkTableFieldExists(tableName, columnName);
      if (!columnExists) {
        issues.push({
          severity: 'critical',
          type: 'data_quality',
          classification: 'data_quality_failure',
          key: `missing_column:${tableName}.${columnName}`,
          message: `Required field ${columnName} missing on ${tableName}`,
          table: tableName,
          field: columnName,
        });

        dataQuality.push({
          table: tableName,
          field: columnName,
          missing: true,
          null_count: null,
          status: 'down',
        });

        continue;
      }

      const nullCount = await getNullCount(tableName, columnName, QUALITY_WINDOWS[tableName] || null);
      const fieldStatus = nullCount > 0 ? 'degraded' : 'ok';

      dataQuality.push({
        table: tableName,
        field: columnName,
        missing: false,
        null_count: nullCount,
        status: fieldStatus,
      });

      if (nullCount > 0) {
        issues.push({
          severity: 'warning',
          type: 'data_quality',
          classification: 'data_quality_failure',
          key: `nulls:${tableName}.${columnName}`,
          message: `Critical field ${tableName}.${columnName} contains null/empty values`,
          table: tableName,
          field: columnName,
          null_count: nullCount,
        });
      }
    }
  }

  for (const pipeline of pipelineReport.pipelines || []) {
    const name = String(pipeline?.name || 'unknown_pipeline');
    const backendUrl = pipeline?.runtime_validation?.backend_endpoint?.url || null;
    const nextUrl = pipeline?.runtime_validation?.next_endpoint?.url || null;

    const checks = [];

    for (const endpoint of [
      { type: 'backend', url: backendUrl },
      { type: 'next', url: nextUrl },
    ]) {
      if (!endpoint.url) {
        checks.push({ type: endpoint.type, url: null, status: 'down', count: 0, http_status: null });
        issues.push({
          severity: 'critical',
          type: 'pipeline_health',
          classification: 'endpoint_failure',
          key: `missing_url:${name}:${endpoint.type}`,
          message: `Missing ${endpoint.type} URL for pipeline ${name}`,
          pipeline: name,
          endpoint_type: endpoint.type,
        });
        continue;
      }

      try {
        const result = await safeFetchJson(endpoint.url);
        const rows = extractRows(result.payload);
        const count = rows.length;
        const endpointStatus = result.ok && count > 0 ? 'ok' : result.ok ? 'degraded' : 'down';

        checks.push({
          type: endpoint.type,
          url: endpoint.url,
          status: endpointStatus,
          count,
          http_status: result.status,
        });

        if (!result.ok || count === 0) {
          const severity = !result.ok ? 'critical' : 'warning';
          const detail = {
            pipeline: name,
            endpoint_type: endpoint.type,
            url: endpoint.url,
            http_status: result.status,
            count,
          };

          issues.push({
            severity,
            type: 'pipeline_health',
            classification: 'endpoint_failure',
            key: `pipeline:${name}:${endpoint.type}`,
            message: `${name} ${endpoint.type} endpoint failed data check`,
            ...detail,
          });

          console.error('DATA FAILURE:', detail);
        }
      } catch (error) {
        checks.push({
          type: endpoint.type,
          url: endpoint.url,
          status: 'down',
          count: 0,
          http_status: null,
          error: error.message,
        });

        const detail = {
          pipeline: name,
          endpoint_type: endpoint.type,
          url: endpoint.url,
          error: error.message,
        };

        issues.push({
          severity: 'critical',
          type: 'pipeline_health',
          classification: 'endpoint_failure',
          key: `pipeline_exception:${name}:${endpoint.type}`,
          message: `${name} ${endpoint.type} endpoint unreachable`,
          ...detail,
        });

        console.error('DATA FAILURE:', detail);
      }
    }

    const pipelineStatus = checks.some((check) => check.status === 'down')
      ? 'down'
      : checks.some((check) => check.status === 'degraded')
        ? 'degraded'
        : 'ok';

    pipelineStatuses.push({
      name,
      status: pipelineStatus,
      checks,
    });
  }

  let parity = {
    symbols: [],
    status: 'ok',
  };

  try {
    const dbParity = await queryWithTimeout(
      `SELECT symbol, price, volume, updated_at
       FROM market_quotes
       WHERE symbol = ANY($1::text[])
       ORDER BY symbol ASC`,
      [PARITY_SYMBOLS],
      { timeoutMs: 3000, maxRetries: 0, label: 'integrity.parity.db_quotes' }
    );

    const backendQuotes = await safeFetchJson(
      `http://localhost:${process.env.PORT || 3000}/api/market/quotes?symbols=${encodeURIComponent(PARITY_SYMBOLS.join(','))}`
    );

    const nextQuotes = await safeFetchJson(
      'http://localhost:3001/api/intelligence/markets?symbols=AAPL,SPY'
    );

    const backendRows = findQuoteRows(backendQuotes.payload);
    const nextRows = findQuoteRows(nextQuotes.payload);

    const dbMap = new Map((dbParity.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
    const backendMap = new Map(backendRows.map((row) => [String(row.symbol || '').toUpperCase(), row]));
    const nextMap = new Map(nextRows.map((row) => [String(row.symbol || '').toUpperCase(), row]));

    const symbolResults = PARITY_SYMBOLS.map((symbol) => {
      const dbRow = dbMap.get(symbol) || null;
      const backendRow = backendMap.get(symbol) || null;
      const nextRow = nextMap.get(symbol) || null;

      const dbPrice = Number(dbRow?.price || 0);
      const backendPrice = Number(backendRow?.price || 0);
      const nextPrice = Number(nextRow?.price || 0);

      const backendDeltaPct = dbPrice > 0 ? Math.abs((backendPrice - dbPrice) / dbPrice) * 100 : null;
      const nextDeltaPct = dbPrice > 0 ? Math.abs((nextPrice - dbPrice) / dbPrice) * 100 : null;

      return {
        symbol,
        db: dbRow ? { price: dbPrice, volume: Number(dbRow.volume || 0), updated_at: dbRow.updated_at } : null,
        backend: backendRow ? { price: backendPrice, volume: Number(backendRow.volume || 0) } : null,
        frontend: nextRow ? { price: nextPrice, volume: Number(nextRow.volume || nextRow.volume_24h || 0) } : null,
        deltas: {
          backend_vs_db_pct: backendDeltaPct,
          frontend_vs_db_pct: nextDeltaPct,
        },
      };
    });

    for (const row of symbolResults) {
      if (!row.db || !row.backend || !row.frontend) {
        issues.push({
          severity: 'warning',
          type: 'frontend_parity',
          classification: 'endpoint_failure',
          key: `missing_parity_symbol:${row.symbol}`,
          message: `Missing parity values for ${row.symbol}`,
          symbol: row.symbol,
        });
        continue;
      }

      if ((row.deltas.backend_vs_db_pct !== null && row.deltas.backend_vs_db_pct > 2) ||
          (row.deltas.frontend_vs_db_pct !== null && row.deltas.frontend_vs_db_pct > 2)) {
        issues.push({
          severity: 'warning',
          type: 'frontend_parity',
          classification: 'endpoint_failure',
          key: `parity_delta:${row.symbol}`,
          message: `Parity drift detected for ${row.symbol}`,
          symbol: row.symbol,
          backend_vs_db_pct: row.deltas.backend_vs_db_pct,
          frontend_vs_db_pct: row.deltas.frontend_vs_db_pct,
        });
      }
    }

    parity = {
      status: symbolResults.some((row) => !row.db || !row.backend || !row.frontend) ? 'degraded' : 'ok',
      symbols: symbolResults,
      backend_http_status: backendQuotes.status,
      frontend_http_status: nextQuotes.status,
    };
  } catch (error) {
    issues.push({
      severity: 'warning',
      type: 'frontend_parity',
      classification: 'endpoint_failure',
      key: 'parity_exception',
      message: 'Failed to compute frontend parity',
      detail: error.message,
    });

    parity = {
      status: 'degraded',
      symbols: [],
      error: error.message,
    };
  }

  for (const issue of issues) {
    if (!issue.classification) {
      issue.classification = classifyIssue(issue);
    }
  }

  const recovery = await runRecoveryEngine(issues);
  const status = summarizeStatus(issues);

  return {
    status,
    checked_at: new Date().toISOString(),
    issues,
    tables: tableStatuses,
    data_quality: dataQuality,
    pipelines: pipelineStatuses,
    parity,
    recovery,
  };
}

module.exports = {
  runDataIntegrityMonitor,
};
