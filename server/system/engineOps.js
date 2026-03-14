const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

function normalizeRowsProcessed(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, Math.trunc(numeric));
  return 0;
}

async function recordEngineTelemetry({ engineName, status = 'ok', rowsProcessed = 0, runtimeMs = null, details = {} }) {
  const engine = String(engineName || '').trim() || 'unknown_engine';
  const payload = {
    engine_name: engine,
    status: String(status || 'unknown'),
    rows_processed: normalizeRowsProcessed(rowsProcessed),
    runtime_ms: Number.isFinite(Number(runtimeMs)) ? Number(runtimeMs) : null,
    ...details,
    updated_at: new Date().toISOString(),
  };

  await queryWithTimeout(
    `INSERT INTO engine_telemetry (engine, payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())`,
    [engine, JSON.stringify(payload)],
    { timeoutMs: 2500, maxRetries: 0, label: 'engine_telemetry.insert' }
  ).catch((error) => {
    logger.warn('engine telemetry insert failed', { engine, error: error.message });
  });

  await queryWithTimeout(
    `INSERT INTO engine_status (engine, status, last_run, runtime_ms, updated_at)
     VALUES ($1, $2, NOW(), $3, NOW())
     ON CONFLICT (engine) DO UPDATE
     SET status = EXCLUDED.status,
         last_run = EXCLUDED.last_run,
         runtime_ms = EXCLUDED.runtime_ms,
         updated_at = NOW()`,
    [engine, payload.status, payload.runtime_ms],
    { timeoutMs: 2500, maxRetries: 0, label: 'engine_status.upsert' }
  ).catch((error) => {
    logger.warn('engine status upsert failed', { engine, error: error.message });
  });
}

async function logSystemAlert({ type = 'ENGINE_FAILURE', source = 'system', severity = 'high', message = 'Unknown system failure' }) {
  await queryWithTimeout(
    `INSERT INTO system_alerts (type, source, severity, message, acknowledged, created_at)
     VALUES ($1, $2, $3, $4, FALSE, NOW())`,
    [String(type), String(source), String(severity), String(message)],
    { timeoutMs: 2500, maxRetries: 0, label: 'system_alerts.insert' }
  ).catch((error) => {
    logger.warn('system alert insert failed', {
      source,
      error: error.message,
    });
  });
}

module.exports = {
  recordEngineTelemetry,
  logSystemAlert,
  normalizeRowsProcessed,
};
