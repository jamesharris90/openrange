const { queryWithTimeout, pool } = require('../db/pg');
const { getAlertSchedulerStatus } = require('../alerts/alert_scheduler');
const { getEngineSchedulerStatus } = require('../engines/scheduler');
const { getConfigLoadStatus } = require('../config/intelligenceConfig');

async function getSystemHealth() {
  let database = {
    available: false,
    detail: null,
  };

  try {
    await queryWithTimeout('SELECT 1 AS ok', [], {
      timeoutMs: 3000,
      label: 'system.health.db_ping',
    });
    database = { available: true, detail: null };
  } catch (error) {
    database = { available: false, detail: error.message };
  }

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
      { timeoutMs: 3000, label: 'system.health.market_quotes_freshness' }
    );
    const lastUpdated = rows[0]?.last_updated ? new Date(rows[0].last_updated) : null;
    const ageMs = lastUpdated ? Date.now() - lastUpdated.getTime() : Number.POSITIVE_INFINITY;
    const stale = !lastUpdated || ageMs > 3 * 60 * 1000;

    marketQuotes = {
      available: Boolean(lastUpdated),
      last_updated: lastUpdated ? lastUpdated.toISOString() : null,
      stale,
      detail: stale ? 'market_quotes data older than 3 minutes' : null,
    };
  } catch (error) {
    marketQuotes = {
      available: false,
      last_updated: null,
      stale: true,
      detail: error.message,
    };
  }

  const poolStats = {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };

  const configStatus = getConfigLoadStatus();
  const status = database.available && !marketQuotes.stale ? 'ok' : 'degraded';

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
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  getSystemHealth,
};
