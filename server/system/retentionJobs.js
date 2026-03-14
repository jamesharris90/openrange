const cron = require('node-cron');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { logSystemAlert, recordEngineTelemetry } = require('./engineOps');

let retentionTask = null;

const RETENTION_TARGETS = [
  {
    engineName: 'retention_intraday_1m',
    tableName: 'intraday_1m',
    whereSql: `"timestamp" < NOW() - INTERVAL '7 days'`,
  },
  {
    engineName: 'retention_flow_signals',
    tableName: 'flow_signals',
    whereSql: `detected_at < NOW() - INTERVAL '30 days'`,
  },
  {
    engineName: 'retention_opportunity_stream',
    tableName: 'opportunity_stream',
    whereSql: `created_at < NOW() - INTERVAL '30 days'`,
  },
];

async function runSingleRetention(target) {
  const startedAt = Date.now();

  try {
    const result = await queryWithTimeout(
      `DELETE FROM ${target.tableName} WHERE ${target.whereSql}`,
      [],
      { timeoutMs: 30000, maxRetries: 0, label: `retention.${target.tableName}.delete` }
    );

    const rowsDeleted = Number(result?.rowCount || 0);
    const runtimeMs = Date.now() - startedAt;

    await recordEngineTelemetry({
      engineName: target.engineName,
      status: 'ok',
      rowsProcessed: rowsDeleted,
      runtimeMs,
      details: {
        table: target.tableName,
        action: 'retention_cleanup',
      },
    });

    logger.info('[RETENTION] cleanup complete', {
      table: target.tableName,
      rowsDeleted,
      runtimeMs,
    });

    return rowsDeleted;
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;

    await recordEngineTelemetry({
      engineName: target.engineName,
      status: 'failed',
      rowsProcessed: 0,
      runtimeMs,
      details: {
        table: target.tableName,
        action: 'retention_cleanup',
        error: error.message,
      },
    });

    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: target.engineName,
      severity: 'high',
      message: `Retention cleanup failed for ${target.tableName}: ${error.message}`,
    });

    logger.error('[RETENTION] cleanup failed', {
      table: target.tableName,
      error: error.message,
    });

    return 0;
  }
}

async function runRetentionCleanup() {
  const totals = await Promise.all(RETENTION_TARGETS.map((target) => runSingleRetention(target)));
  const rowsDeleted = totals.reduce((sum, count) => sum + Number(count || 0), 0);
  logger.info('[RETENTION] cycle complete', { rowsDeleted });
  return rowsDeleted;
}

function startRetentionJobs() {
  if (retentionTask) return;

  // Run daily at 02:15 server time.
  retentionTask = cron.schedule('15 2 * * *', () => {
    runRetentionCleanup().catch((error) => {
      logger.error('[RETENTION] scheduled run failed', { error: error.message });
    });
  });

  logger.info('[RETENTION] scheduler started (daily 02:15)');
}

module.exports = {
  startRetentionJobs,
  runRetentionCleanup,
};
