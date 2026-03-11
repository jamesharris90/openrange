const { queryWithTimeout } = require('../db/pg');
const eventBus = require('../events/eventBus');
const EVENT_TYPES = require('../events/eventTypes');
const { dispatchAlert } = require('../system/alertDispatcher');
const logger = require('../logger');

let initialized = false;
let latestAlertEngineState = {
  status: 'idle',
  initialized: false,
  alerts_created: 0,
  last_alert_at: null,
  errors: 0,
};

async function ensureSystemAlertsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS system_alerts (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      source TEXT,
      severity TEXT NOT NULL DEFAULT 'medium',
      message TEXT NOT NULL,
      acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'alerts.system_alerts.ensure_table', maxRetries: 0 }
  );
}

function resolveSeverity(payload) {
  const level = String(payload?.severity || '').toLowerCase();
  if (['low', 'medium', 'high', 'critical'].includes(level)) return level;
  if (payload?.issue === 'engine_failure') return 'high';
  return 'medium';
}

function resolveMessage(eventType, payload) {
  if (payload?.message) return String(payload.message);
  const issue = payload?.issue ? ` issue=${payload.issue}` : '';
  const symbol = payload?.symbol ? ` symbol=${payload.symbol}` : '';
  return `${eventType}${symbol}${issue}`;
}

async function createAlert(eventType, payload = {}) {
  const alert = {
    type: String(eventType || EVENT_TYPES.SYSTEM_ALERT),
    source: String(payload.source || payload.engine || payload.provider || 'system'),
    severity: resolveSeverity(payload),
    message: resolveMessage(eventType, payload),
    acknowledged: false,
    created_at: new Date().toISOString(),
  };

  try {
    await ensureSystemAlertsTable();
    await queryWithTimeout(
      `INSERT INTO system_alerts (type, source, severity, message, acknowledged, created_at)
       VALUES ($1, $2, $3, $4, FALSE, NOW())`,
      [alert.type, alert.source, alert.severity, alert.message],
      { timeoutMs: 3500, label: 'alerts.system_alerts.insert', maxRetries: 0 }
    );

    latestAlertEngineState = {
      status: 'ok',
      initialized,
      alerts_created: latestAlertEngineState.alerts_created + 1,
      last_alert_at: alert.created_at,
      errors: latestAlertEngineState.errors,
    };

    await dispatchAlert(alert);

    eventBus.emit(EVENT_TYPES.SYSTEM_ALERT, {
      source: 'system_alert_engine',
      ...alert,
    });
  } catch (error) {
    latestAlertEngineState = {
      ...latestAlertEngineState,
      status: 'warning',
      errors: latestAlertEngineState.errors + 1,
    };
    logger.error('[ENGINE ERROR] system_alert_engine failed', { error: error.message, type: eventType });
  }
}

function startSystemAlertEngine() {
  if (initialized) return;

  const subscribedEvents = [
    EVENT_TYPES.PROVIDER_FAILURE,
    EVENT_TYPES.ENGINE_FAILURE,
    EVENT_TYPES.DATA_INTEGRITY_WARNING,
    EVENT_TYPES.PROVIDER_DISCREPANCY,
    EVENT_TYPES.PRICE_ANOMALY,
    EVENT_TYPES.DUPLICATE_TICK,
  ];

  for (const eventType of subscribedEvents) {
    eventBus.on(eventType, (payload) => {
      createAlert(eventType, payload);
    });
  }

  initialized = true;
  latestAlertEngineState = {
    ...latestAlertEngineState,
    status: 'ok',
    initialized: true,
  };
  logger.info('[SYSTEM_ALERT_ENGINE] initialized');
}

function getSystemAlertEngineHealth() {
  return {
    ...latestAlertEngineState,
    initialized,
  };
}

module.exports = {
  ensureSystemAlertsTable,
  startSystemAlertEngine,
  getSystemAlertEngineHealth,
};
