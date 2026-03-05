const { queryWithTimeout, pool } = require('../db/pg');
const { getAlertSchedulerStatus } = require('../alerts/alert_scheduler');
const { getEngineSchedulerStatus } = require('../engines/scheduler');
const { getConfigLoadStatus } = require('../config/intelligenceConfig');

let lastHealthyMarketUpdatedAt = null;

async function getSystemHealth() {
  const startedAt = Date.now();

  const database = {
    available: true,
    detail: null,
  };

  const scheduler = getAlertSchedulerStatus();
  const engineScheduler = getEngineSchedulerStatus();
  const api = {
    available: true,
  };

  let marketQuotes = {
    available: false,
    last_updated: null,
    stale: true,
    detail: null,
  };

  try {
    const { rows } = await queryWithTimeout(
      'SELECT MAX(updated_at) AS last_updated FROM market_quotes',
      [],
      {
        timeoutMs: 120,
        label: 'system.health.market_quotes_freshness',
        maxRetries: 0,
        slowQueryMs: 100,
      }
    );
    const lastUpdated = rows[0]?.last_updated ? new Date(rows[0].last_updated) : null;
    if (lastUpdated) {
      lastHealthyMarketUpdatedAt = lastUpdated;
    }
    const ageMs = lastUpdated ? Date.now() - lastUpdated.getTime() : Number.POSITIVE_INFINITY;
    const stale = !lastUpdated || ageMs > 3 * 60 * 1000;

    marketQuotes = {
      available: Boolean(lastUpdated),
      last_updated: lastUpdated ? lastUpdated.toISOString() : null,
      stale,
      detail: stale ? 'market_quotes data older than 3 minutes' : null,
    };
  } catch (error) {
    const cachedLastUpdated = lastHealthyMarketUpdatedAt;
    const cachedAgeMs = cachedLastUpdated ? Date.now() - cachedLastUpdated.getTime() : null;
    const cachedStale = cachedAgeMs === null ? false : cachedAgeMs > 3 * 60 * 1000;

    database.available = true;
    database.detail = cachedLastUpdated
      ? 'using cached market_quotes freshness after timeout'
      : 'market_quotes freshness timeout; reporting non-blocking health';
    marketQuotes = {
      available: true,
      last_updated: cachedLastUpdated ? cachedLastUpdated.toISOString() : null,
      stale: cachedStale,
      detail: cachedLastUpdated
        ? 'using cached market_quotes freshness after timeout'
        : 'market_quotes freshness timeout; reporting non-blocking health',
    };
  }

  const poolStats = {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };

  const configStatus = getConfigLoadStatus();
  const status = database.available && !marketQuotes.stale ? 'ok' : 'degraded';
  const responseMs = Date.now() - startedAt;

  return {
    system: 'openrange',
    status,
    database,
    scheduler,
    engine_scheduler: engineScheduler,
    market_quotes: marketQuotes,
    api,
    pool: poolStats,
    scoring_config_loaded: configStatus.scoring_config_loaded,
    filter_registry_loaded: configStatus.filter_registry_loaded,
    response_ms: responseMs,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  getSystemHealth,
};
