const { queryWithTimeout, pool } = require('../db/pg');
const { getAlertSchedulerStatus } = require('../alerts/alert_scheduler');
const { getEngineSchedulerStatus } = require('../engines/scheduler');
const { getConfigLoadStatus } = require('../config/intelligenceConfig');

const FRESHNESS_TARGETS = [
  {
    key: 'intraday_1m',
    label: 'market_data_freshness',
    sql: 'SELECT MAX("timestamp") AS last_update FROM intraday_1m',
  },
  {
    key: 'flow_signals',
    label: 'signal_engine_status',
    sql: 'SELECT MAX(detected_at) AS last_update FROM flow_signals',
  },
  {
    key: 'opportunity_stream',
    label: 'opportunity_engine_status',
    sql: 'SELECT MAX(created_at) AS last_update FROM opportunity_stream',
  },
  {
    key: 'news_articles',
    label: 'news_ingestion_status',
    sql: 'SELECT MAX(published_at) AS last_update FROM news_articles',
  },
];

function classifyDelay(delaySeconds) {
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0) return 'red';
  if (delaySeconds < 120) return 'green';
  if (delaySeconds < 600) return 'amber';
  return 'red';
}

function computeOverallStatus(items) {
  const values = Object.values(items || {});
  if (values.some((item) => item?.status === 'red' || item?.error)) return 'critical';
  if (values.some((item) => item?.status === 'amber')) return 'degraded';
  return 'ok';
}

async function fetchFreshnessTarget(target) {
  try {
    const { rows } = await queryWithTimeout(
      target.sql,
      [],
      {
        timeoutMs: 240,
        label: `system.freshness.${target.key}`,
        maxRetries: 0,
        slowQueryMs: 180,
      }
    );

    const value = rows?.[0]?.last_update ? new Date(rows[0].last_update) : null;
    const delaySeconds = value ? Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000)) : null;

    return {
      last_update: value ? value.toISOString() : null,
      delay_seconds: delaySeconds,
      status: classifyDelay(delaySeconds),
      error: null,
    };
  } catch (error) {
    return {
      last_update: null,
      delay_seconds: null,
      status: 'red',
      error: error.message,
    };
  }
}

async function getDataFreshness() {
  const results = await Promise.all(FRESHNESS_TARGETS.map((target) => fetchFreshnessTarget(target)));
  const payload = {};
  FRESHNESS_TARGETS.forEach((target, index) => {
    payload[target.key] = results[index];
  });
  return payload;
}

async function getSystemHealth() {
  const startedAt = Date.now();
  const freshness = await getDataFreshness();

  const cardStatuses = {};
  FRESHNESS_TARGETS.forEach((target) => {
    cardStatuses[target.label] = freshness[target.key] || {
      last_update: null,
      delay_seconds: null,
      status: 'red',
      error: 'unavailable',
    };
  });

  const scheduler = getAlertSchedulerStatus();
  const engineScheduler = getEngineSchedulerStatus();
  const poolStats = {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
  const configStatus = getConfigLoadStatus();

  return {
    system: 'openrange',
    status: computeOverallStatus(freshness),
    checked_at: new Date().toISOString(),
    response_ms: Date.now() - startedAt,
    freshness,
    cards: cardStatuses,
    scheduler,
    engine_scheduler: engineScheduler,
    pool: poolStats,
    scoring_config_loaded: configStatus.scoring_config_loaded,
    filter_registry_loaded: configStatus.filter_registry_loaded,
  };
}

module.exports = {
  getSystemHealth,
  getDataFreshness,
};
