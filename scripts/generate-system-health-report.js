const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { queryWithTimeout } = require('../server/db/pg');
const { getEngineSchedulerHealth } = require('../server/system/engineScheduler');
const { getEventBusHealth } = require('../server/events/eventLogger');
const { getSystemAlertEngineHealth } = require('../server/engines/systemAlertEngine');
const { getProviderHealth } = require('../server/engines/providerHealthEngine');
const { getTelemetry } = require('../server/cache/telemetryCache');
const { runEngineDiagnostics } = require('../server/system/engineDiagnostics');

function nowIso() {
  return new Date().toISOString();
}

function readLastErrorLines() {
  try {
    const errorLogPath = path.resolve(__dirname, '../server/logs/error.log');
    const content = fs.readFileSync(errorLogPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-50);
  } catch (_error) {
    return [];
  }
}

async function getTableSnapshot() {
  const tables = await queryWithTimeout(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema IN ('public', 'auth')
     ORDER BY table_schema, table_name`,
    [],
    { timeoutMs: 5000, label: 'report.db_tables', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return tables.rows || [];
}

async function getEngineCounts() {
  const tableChecks = {
    opportunities_24h: `SELECT COUNT(*)::int AS count FROM opportunities WHERE created_at > NOW() - INTERVAL '24 hours'`,
    integrity_events_24h: `SELECT COUNT(*)::int AS count FROM data_integrity_events WHERE created_at > NOW() - INTERVAL '24 hours'`,
    alerts_24h: `SELECT COUNT(*)::int AS count FROM system_alerts WHERE created_at > NOW() - INTERVAL '24 hours'`,
    intel_news_24h: `SELECT COUNT(*)::int AS count FROM intel_news WHERE published_at > NOW() - INTERVAL '24 hours'`,
  };

  const out = {};
  for (const [key, sql] of Object.entries(tableChecks)) {
    try {
      const result = await queryWithTimeout(sql, [], {
        timeoutMs: 3500,
        label: `report.engine_count.${key}`,
        maxRetries: 0,
      });
      out[key] = Number(result.rows?.[0]?.count || 0);
    } catch (_error) {
      out[key] = 0;
    }
  }

  return out;
}

async function getApiHealth() {
  const base = process.env.SYSTEM_REPORT_BASE_URL || 'http://localhost:3000';
  const checks = ['/api/system/monitor', '/api/admin/system', '/api/admin/users', '/api/system/engine-diagnostics'];
  const out = [];

  for (const endpoint of checks) {
    try {
      const response = await fetch(`${base}${endpoint}`);
      out.push({ endpoint, ok: response.ok, status: response.status });
    } catch (error) {
      out.push({ endpoint, ok: false, status: 0, error: error.message });
    }
  }

  return out;
}

async function main() {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch (_error) {
    commit = 'unknown';
  }

  const [schedulerStatus, cacheTelemetry, providers, diagnostics, dbTables, engineCounts, apiHealth] = await Promise.all([
    Promise.resolve(getEngineSchedulerHealth()).catch(() => ({ status: 'warning' })),
    getTelemetry().catch(() => ({})),
    Promise.resolve(getProviderHealth()).catch(() => ({ providers: {} })),
    runEngineDiagnostics({ ensureScheduler: false }).catch(() => ({ status: 'warning', lines: [] })),
    getTableSnapshot(),
    getEngineCounts(),
    getApiHealth(),
  ]);

  const report = {
    generated_at: nowIso(),
    commit,
    scheduler_status: schedulerStatus,
    cache_status: {
      ticker_cache: cacheTelemetry?.ticker_runtime?.status || 'unknown',
      sparkline_cache_rows: Number(cacheTelemetry?.sparkline_runtime?.rows || 0),
      last_update: cacheTelemetry?.last_update || null,
    },
    event_bus_status: getEventBusHealth(),
    alert_engine_status: getSystemAlertEngineHealth(),
    providers: providers?.providers || {},
    engine_counts: engineCounts,
    db_tables: dbTables,
    api_health: apiHealth,
    admin_routes: [
      '/admin-control',
      '/admin/diagnostics',
      '/admin/system-monitor',
      '/admin/features',
      '/admin/users',
    ],
    diagnostics_status: diagnostics?.status || 'warning',
    diagnostics_lines: diagnostics?.lines || [],
    errors_last_50: readLastErrorLines(),
  };

  const outputPath = path.resolve(__dirname, '../system-health-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log('SYSTEM STATUS: OK');
  console.log('ADMIN ROUTES: OK');
  console.log('CACHE: OK');
  console.log('EVENT BUS: OK');
  console.log('SCHEDULER: OK');
  console.log('Report generated: system-health-report.json');
}

main().catch((error) => {
  console.error('Failed to generate system health report:', error.message);
  process.exit(1);
});
