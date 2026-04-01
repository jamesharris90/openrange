const { getPoolStats } = require('../db/pg');

async function getCanonicalTruthSnapshot(queryFn) {
  const { rows } = await queryFn(
    `SELECT
       (SELECT COUNT(*)::int FROM stocks_in_play) AS stocks_in_play_rows,
       (SELECT COUNT(*)::int FROM opportunities_v2) AS opportunities_v2_rows,
       (SELECT MAX(created_at) FROM system_events WHERE event_type ILIKE 'ENGINE_%') AS last_engine_run_at`,
    [],
    {
      timeoutMs: 3000,
      label: 'admin_truth.canonical_snapshot',
      maxRetries: 0,
    }
  );

  const snapshot = rows?.[0] || {};
  const stocksInPlayRows = Number(snapshot.stocks_in_play_rows || 0);
  const opportunitiesRows = Number(snapshot.opportunities_v2_rows || 0);
  const enginesPopulated = stocksInPlayRows > 0 || opportunitiesRows > 0;

  return {
    stocks_in_play_rows: stocksInPlayRows,
    opportunities_v2_rows: opportunitiesRows,
    last_engine_run_at: snapshot.last_engine_run_at ? new Date(snapshot.last_engine_run_at).toISOString() : null,
    data_status: enginesPopulated ? 'READY' : 'NO_DATA',
    engines_populated: enginesPopulated,
  };
}

async function getDbConnectionSnapshot(queryFn) {
  const poolStats = getPoolStats();

  try {
    const { rows } = await queryFn(
      `SELECT
         COUNT(*)::int AS connection_count,
         COUNT(*) FILTER (WHERE state = 'active')::int AS active_connections,
         COUNT(*) FILTER (WHERE state = 'idle')::int AS idle_connections
       FROM pg_stat_activity
       WHERE datname = current_database()`,
      [],
      {
        timeoutMs: 2500,
        label: 'admin_truth.db_connections',
        maxRetries: 0,
      }
    );

    const snapshot = rows?.[0] || {};
    return {
      connection_count: Number(snapshot.connection_count || 0),
      active_connections: Number(snapshot.active_connections || 0),
      idle_connections: Number(snapshot.idle_connections || 0),
      waiting_count: Number(poolStats.waitingCount || 0),
      max_connections: Number(poolStats.maxConnections || 10),
      pooled: Boolean(poolStats.pooled),
      host: poolStats.host || null,
      port: poolStats.port || null,
    };
  } catch (_error) {
    return {
      connection_count: Number(poolStats.totalCount || 0),
      active_connections: Math.max(0, Number(poolStats.totalCount || 0) - Number(poolStats.idleCount || 0)),
      idle_connections: Number(poolStats.idleCount || 0),
      waiting_count: Number(poolStats.waitingCount || 0),
      max_connections: Number(poolStats.maxConnections || 10),
      pooled: Boolean(poolStats.pooled),
      host: poolStats.host || null,
      port: poolStats.port || null,
    };
  }
}

function isEnginesNotPopulated(snapshot) {
  return Number(snapshot?.stocks_in_play_rows || 0) === 0 && Number(snapshot?.opportunities_v2_rows || 0) === 0;
}

function noDataResponse() {
  return {
    status: 'NO_DATA',
    reason: 'ENGINES_NOT_POPULATED',
  };
}

module.exports = {
  getCanonicalTruthSnapshot,
  getDbConnectionSnapshot,
  isEnginesNotPopulated,
  noDataResponse,
};