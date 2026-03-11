const fs = require('fs');
const path = require('path');

const { queryWithTimeout } = require('../server/db/pg');
const { getEngineSchedulerStatus } = require('../server/engines/scheduler');
const { getIntelligencePipelineHealth } = require('../server/engines/intelligencePipeline');
const { getProviderHealth, runProviderHealthCheck } = require('../server/engines/providerHealthEngine');

async function count(sql, label) {
  try {
    const result = await queryWithTimeout(sql, [], {
      timeoutMs: 4000,
      label,
      maxRetries: 0,
    });
    return Number(result.rows?.[0]?.count || 0);
  } catch (_err) {
    return 0;
  }
}

async function main() {
  await runProviderHealthCheck().catch(() => null);

  const [opportunities24h, intelNews24h] = await Promise.all([
    count(
      `SELECT COUNT(*)::int AS count FROM opportunities WHERE created_at > NOW() - INTERVAL '24 hours'`,
      'engine_health_report.opportunities_24h'
    ),
    count(
      `SELECT COUNT(*)::int AS count FROM intel_news WHERE created_at > NOW() - INTERVAL '24 hours'`,
      'engine_health_report.intel_news_24h'
    ),
  ]);

  const pipeline = getIntelligencePipelineHealth();
  const providers = getProviderHealth();

  const report = {
    generated_at: new Date().toISOString(),
    scheduler_status: getEngineSchedulerStatus(),
    pipeline_status: pipeline?.status || 'unknown',
    engine_failures: pipeline?.errors || [],
    provider_latency: providers?.providers || {},
    opportunities_24h: opportunities24h,
    intel_news_24h: intelNews24h,
  };

  const outputPath = path.resolve(__dirname, '../engine-health-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log('ENGINE HEALTH REPORT GENERATED');
}

main().catch((error) => {
  console.error('Failed to generate engine health report:', error.message);
  process.exit(1);
});
