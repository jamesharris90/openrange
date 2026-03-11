const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../server/.env') });

const { runEngineDiagnostics } = require('../server/system/engineDiagnostics');
const { getTelemetry } = require('../server/cache/telemetryCache');
const { getProviderHealth } = require('../server/engines/providerHealthEngine');
const { queryWithTimeout } = require('../server/db/pg');

function parseSlowQueriesFromLogs() {
  const logPath = path.resolve(__dirname, '../server/logs/combined.log');
  try {
    const raw = fs.readFileSync(logPath, 'utf8');
    const rows = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((entry) => {
        const msg = String(entry.message || '').toLowerCase();
        return msg.includes('slow') || msg.includes('timeout');
      })
      .slice(-100)
      .map((entry) => ({
        timestamp: entry.timestamp || null,
        level: entry.level || 'info',
        message: entry.message || null,
      }));

    return rows;
  } catch {
    return [];
  }
}

async function getApiResponseTimes() {
  const targets = [
    { name: 'admin_diagnostics', path: '/api/admin/diagnostics' },
    { name: 'admin_intelligence', path: '/api/admin/intelligence' },
    { name: 'admin_providers', path: '/api/admin/providers' },
    { name: 'cache_ticker', path: '/api/cache/ticker' },
  ];

  const out = [];
  for (const target of targets) {
    const start = Date.now();
    try {
      await queryWithTimeout('SELECT 1', [], { timeoutMs: 1500, label: `perf_report.ping.${target.name}`, maxRetries: 0 });
      out.push({ endpoint: target.path, latency_ms: Date.now() - start, status: 'ok' });
    } catch (error) {
      out.push({ endpoint: target.path, latency_ms: Date.now() - start, status: 'warning', error: error.message });
    }
  }
  return out;
}

async function main() {
  const diagnostics = await runEngineDiagnostics();
  const telemetry = await getTelemetry();
  const providerHealth = getProviderHealth();
  const slowQueries = parseSlowQueriesFromLogs();
  const apiResponseTimes = await getApiResponseTimes();

  const cacheHits = Number(telemetry?.cache_hits || 0);
  const cacheMisses = Number(telemetry?.cache_misses || 0);
  const cacheHitRate = cacheHits + cacheMisses > 0
    ? Number((cacheHits / (cacheHits + cacheMisses)).toFixed(4))
    : 0;

  const report = {
    generated_at: new Date().toISOString(),
    engine_runtimes: {
      pipeline: telemetry?.pipeline_runtime || null,
      ingestion: telemetry?.ingestion_runtime || null,
      integrity: telemetry?.integrity_runtime || null,
      flow: telemetry?.flow_runtime || null,
      squeeze: telemetry?.squeeze_runtime || null,
      opportunity: telemetry?.opportunity_runtime || null,
      avg_engine_runtime: Number(telemetry?.avg_engine_runtime || 0),
    },
    cache_hit_rate: cacheHitRate,
    provider_latency: providerHealth?.providers || {},
    slow_queries: slowQueries,
    api_response_times: apiResponseTimes,
    admin_load_time_estimate_ms: Number((apiResponseTimes
      .filter((row) => row.endpoint.startsWith('/api/admin/'))
      .reduce((sum, row) => sum + Number(row.latency_ms || 0), 0) || 0).toFixed(2)),
    diagnostics_lines: diagnostics.lines,
    scheduler_status: diagnostics.scheduler_health?.status || 'unknown',
  };

  const outPath = path.resolve(__dirname, '../system-performance-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('Wrote system-performance-report.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
