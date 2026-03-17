const cron = require('node-cron');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { logSystemAlert, recordEngineTelemetry } = require('./engineOps');

let retentionTask = null;

const RETENTION_TARGETS = [
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

async function ensureIntradayIndexes() {
  await queryWithTimeout(
    'CREATE INDEX IF NOT EXISTS idx_intraday_1m_symbol ON intraday_1m(symbol)',
    [],
    { timeoutMs: 10000, maxRetries: 0, label: 'retention.intraday_1m.index_symbol' }
  );

  await queryWithTimeout(
    'CREATE INDEX IF NOT EXISTS idx_intraday_1m_timestamp ON intraday_1m("timestamp")',
    [],
    { timeoutMs: 10000, maxRetries: 0, label: 'retention.intraday_1m.index_timestamp' }
  );
}

async function intradayRetentionJob() {
  const startedAt = Date.now();
  try {
    await ensureIntradayIndexes();

    const result = await queryWithTimeout(
      `DELETE FROM intraday_1m
       WHERE "timestamp" < NOW() - INTERVAL '30 days'`,
      [],
      { timeoutMs: 60000, maxRetries: 0, label: 'retention.intraday_1m.delete_30d' }
    );

    const rowsDeleted = Number(result?.rowCount || 0);

    await recordEngineTelemetry({
      engineName: 'intradayRetentionJob',
      status: 'ok',
      rowsProcessed: rowsDeleted,
      runtimeMs: Date.now() - startedAt,
      details: {
        table: 'intraday_1m',
        retention_window: '30 days',
        action: 'retention_cleanup',
      },
    });

    logger.info('[RETENTION] intradayRetentionJob complete', {
      table: 'intraday_1m',
      rowsDeleted,
      retentionWindow: '30 days',
    });

    return rowsDeleted;
  } catch (error) {
    await recordEngineTelemetry({
      engineName: 'intradayRetentionJob',
      status: 'failed',
      rowsProcessed: 0,
      runtimeMs: Date.now() - startedAt,
      details: {
        table: 'intraday_1m',
        retention_window: '30 days',
        action: 'retention_cleanup',
        error: error.message,
      },
    });

    logger.error('[RETENTION] intradayRetentionJob failed', {
      table: 'intraday_1m',
      error: error.message,
    });

    return 0;
  }
}

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
  const intradayDeleted = await intradayRetentionJob();
  const totals = await Promise.all(RETENTION_TARGETS.map((target) => runSingleRetention(target)));
  totals.unshift(intradayDeleted);
  const rowsDeleted = totals.reduce((sum, count) => sum + Number(count || 0), 0);
  logger.info('[RETENTION] cycle complete', { rowsDeleted });
  return rowsDeleted;
}

function startRetentionJobs() {
  if (retentionTask) return;

  // Run daily after market close (17:15 America/New_York).
  retentionTask = cron.schedule('15 17 * * 1-5', () => {
    runRetentionCleanup().catch((error) => {
      logger.error('[RETENTION] scheduled run failed', { error: error.message });
    });
  }, {
    timezone: 'America/New_York',
  });

  logger.info('[RETENTION] scheduler started (weekdays 17:15 America/New_York)');
}

module.exports = {
  startRetentionJobs,
  runRetentionCleanup,
};
