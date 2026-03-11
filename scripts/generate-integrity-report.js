const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../server/.env') });

const { queryWithTimeout } = require('../server/db/pg');
const { runEngineDiagnostics } = require('../server/system/engineDiagnostics');
const { getEventBusHealth } = require('../server/events/eventLogger');

async function getRowsCount(table) {
  try {
    const { rows } = await queryWithTimeout(`SELECT COUNT(*)::bigint AS rows FROM ${table}`, [], {
      timeoutMs: 7000,
      label: `integrity_report.count.${table}`,
      maxRetries: 0,
    });
    return Number(rows?.[0]?.rows || 0);
  } catch {
    return 0;
  }
}

async function getRecentRows(table, columns, limit = 50) {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT ${columns.join(', ')} FROM ${table} ORDER BY created_at DESC LIMIT $1`,
      [limit],
      { timeoutMs: 7000, label: `integrity_report.recent.${table}`, maxRetries: 0 }
    );
    return rows || [];
  } catch {
    return [];
  }
}

async function main() {
  const diagnostics = await runEngineDiagnostics();

  const report = {
    generated_at: new Date().toISOString(),
    engine_health: {
      status: diagnostics.status,
      engines: diagnostics.engines,
      lines: diagnostics.lines,
    },
    provider_health: diagnostics.provider_health || {},
    event_bus_health: {
      ...getEventBusHealth(),
      events_logged_total: await getRowsCount('system_events'),
    },
    integrity_events: {
      total: await getRowsCount('data_integrity_events'),
      recent: await getRecentRows(
        'data_integrity_events',
        ['id', 'event_type', 'source', 'symbol', 'issue', 'severity', 'created_at'],
        100
      ),
    },
    system_alerts: {
      total: await getRowsCount('system_alerts'),
      recent: await getRecentRows(
        'system_alerts',
        ['id', 'type', 'source', 'severity', 'message', 'acknowledged', 'created_at'],
        100
      ),
    },
    cache_health: diagnostics.cache_health || {},
  };

  const outPath = path.resolve(__dirname, '../system-integrity-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('Wrote system-integrity-report.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
