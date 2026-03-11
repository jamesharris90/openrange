const fs = require('fs');
const path = require('path');

const { queryWithTimeout } = require('../server/db/pg');
const { getProviderHealth, runProviderHealthCheck } = require('../server/engines/providerHealthEngine');
const { getIntelligencePipelineHealth } = require('../server/engines/intelligencePipeline');
const { getEngineSchedulerStatus } = require('../server/engines/scheduler');

async function getCount(sql, label) {
  try {
    const result = await queryWithTimeout(sql, [], {
      timeoutMs: 4000,
      label,
      maxRetries: 0,
    });
    return Number(result.rows?.[0]?.count || 0);
  } catch (_error) {
    return 0;
  }
}

async function main() {
  await runProviderHealthCheck().catch(() => null);

  const [opportunitiesCount, intelNewsCount, alertsCount] = await Promise.all([
    getCount(
      `SELECT COUNT(*)::int AS count FROM opportunities WHERE created_at > NOW() - INTERVAL '24 hours'`,
      'recovery_report.opportunities_24h'
    ),
    getCount(
      `SELECT COUNT(*)::int AS count FROM intel_news WHERE created_at > NOW() - INTERVAL '24 hours'`,
      'recovery_report.intel_news_24h'
    ),
    getCount(
      `SELECT COUNT(*)::int AS count FROM system_alerts WHERE created_at > NOW() - INTERVAL '24 hours'`,
      'recovery_report.alerts_24h'
    ),
  ]);

  const report = {
    generated_at: new Date().toISOString(),
    scheduler_status: getEngineSchedulerStatus(),
    pipeline_last_run: getIntelligencePipelineHealth(),
    opportunities_count: opportunitiesCount,
    intel_news_count: intelNewsCount,
    alerts_count: alertsCount,
    providers_status: getProviderHealth(),
  };

  const outputPath = path.resolve(__dirname, '../data-recovery-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  const providers = Object.values(report.providers_status?.providers || {});
  const providersOk = providers.length > 0 && providers.every((provider) => provider.status === 'ok');

  console.log(`DATA PIPELINE: ${report.pipeline_last_run?.status === 'ok' ? 'OK' : 'WARN'}`);
  console.log(`SCHEDULER: ${report.scheduler_status?.started ? 'ACTIVE' : 'INACTIVE'}`);
  console.log(`PROVIDERS: ${providersOk ? 'OK' : 'WARN'}`);
  console.log(`OPPORTUNITIES > 0: ${report.opportunities_count > 0 ? 'YES' : 'NO'}`);
  console.log(`NEWS > 0: ${report.intel_news_count > 0 ? 'YES' : 'NO'}`);
  console.log('Report generated: data-recovery-report.json');
}

main().catch((error) => {
  console.error('Failed to generate data recovery report:', error.message);
  process.exit(1);
});
