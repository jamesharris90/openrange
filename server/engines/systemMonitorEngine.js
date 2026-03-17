const { queryWithTimeout } = require('../db/pg');

function toLagSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function toStatus(value) {
  const s = String(value || 'unknown').toLowerCase();
  if (s === 'healthy' || s === 'ok' || s === 'running') {
    return 'OK';
  }
  if (s === 'warning' || s === 'degraded') {
    return 'WARNING';
  }
  if (s === 'failed' || s === 'critical' || s === 'error') {
    return 'CRITICAL';
  }
  return 'OK';
}

async function loadEngineRows() {
  const { rows } = await queryWithTimeout(
    `SELECT engine_name, status,
            COALESCE(EXTRACT(EPOCH FROM (NOW() - COALESCE(last_run_at, NOW())))::int, 0) AS lag_seconds
     FROM engine_status`,
    [],
    { timeoutMs: 5000, label: 'engines.system_monitor.load_engine_rows', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return rows || [];
}

async function getSystemMonitorPayload() {
  const rows = await loadEngineRows();
  const byName = new Map(rows.map((row) => [String(row.engine_name || '').toLowerCase(), row]));

  const pick = (needle) => {
    const key = Array.from(byName.keys()).find((name) => name.includes(needle));
    return key ? byName.get(key) : null;
  };

  const stocks = pick('stocks') || pick('stocksinplay') || null;
  const outcomes = pick('tradeoutcome') || pick('outcome') || null;
  const narrative = pick('narrative') || null;

  const engineHealth = [
    {
      engine: 'stocksInPlay',
      status: toStatus(stocks?.status),
      lag: toLagSeconds(stocks?.lag_seconds),
    },
    {
      engine: 'tradeOutcome',
      status: toStatus(outcomes?.status),
      lag: toLagSeconds(outcomes?.lag_seconds),
    },
    {
      engine: 'narrativeEngine',
      status: toStatus(narrative?.status),
      lag: toLagSeconds(narrative?.lag_seconds),
    },
  ];

  return { engineHealth };
}

module.exports = {
  getSystemMonitorPayload,
};
