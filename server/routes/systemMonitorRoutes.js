const express = require('express');
const { queryWithTimeout } = require('../db/pg');
const { safeQuery } = require('../utils/safeQuery');
const { getProviderHealth } = require('../engines/providerHealthEngine');
const { getEventBusHealth } = require('../events/eventLogger');
const { getSystemAlertEngineHealth } = require('../engines/systemAlertEngine');
const { getEngineSchedulerHealth } = require('../system/engineScheduler');

const router = express.Router();

function toSafeList(value) {
  return Array.isArray(value) ? value : [];
}

router.get('/monitor', async (_req, res) => {
  const db = {
    query: (sql, params = []) => queryWithTimeout(sql, params, {
      timeoutMs: 5000,
      maxRetries: 0,
      label: 'system.monitor.safe_query',
    }),
  };

  const events = await safeQuery(
    db,
    `SELECT id, event_type, source, symbol, payload, created_at
     FROM system_events
     ORDER BY created_at DESC
     LIMIT 100`
  );

  const integrity = await safeQuery(
    db,
    `SELECT id, event_type, source, symbol, issue, severity, payload, created_at
     FROM data_integrity_events
     ORDER BY created_at DESC
     LIMIT 100`
  );

  const alerts = await safeQuery(
    db,
    `SELECT id, type, source, severity, message, acknowledged, created_at
     FROM system_alerts
     ORDER BY created_at DESC
     LIMIT 100`
  );

  const engines = await safeQuery(
    db,
    `SELECT engine_name, status, execution_time_ms, created_at
     FROM engine_runtime
     ORDER BY created_at DESC
     LIMIT 100`
  );

  const providerRows = await safeQuery(
    db,
    `SELECT provider, status, detail, checked_at
     FROM provider_health
     ORDER BY checked_at DESC
     LIMIT 100`
  );

  const providerHealth = getProviderHealth();
  const providersFromEngine = Object.entries(providerHealth?.providers || {}).map(([provider, payload]) => ({
    provider,
    status: payload?.status || 'unknown',
    detail: payload?.message || payload?.detail || null,
    checked_at: payload?.checked_at || null,
  }));

  const responseData = {
    system: 'ok',
    event_bus: getEventBusHealth()?.logger_initialized ? 'ok' : 'warning',
    alert_engine: getSystemAlertEngineHealth()?.initialized ? 'ok' : 'warning',
    integrity_events: toSafeList(integrity),
    alerts: toSafeList(alerts),
    providers: providerRows.length ? providerRows : providersFromEngine,
    engines: toSafeList(engines),
    scheduler: getEngineSchedulerHealth(),
    recent_events: toSafeList(events),
  };

  // Never throw and always return predictable contract.
  return res.json({
    status: 'ok',
    data: responseData,
    ...responseData,
  });
});

module.exports = router;
