const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

let loggerInitialized = false;
let latestEventLog = {
  status: 'idle',
  last_event_at: null,
  events_logged: 0,
  errors: 0,
};

async function ensureSystemEventsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS system_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      source TEXT,
      symbol TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'events.system_events.ensure_table', maxRetries: 0 }
  );
}

async function logSystemEvent({ event_type, source, symbol, payload }) {
  try {
    await ensureSystemEventsTable();
    await queryWithTimeout(
      `INSERT INTO system_events (event_type, source, symbol, payload, created_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW())`,
      [
        String(event_type || 'UNKNOWN_EVENT'),
        source ? String(source) : null,
        symbol ? String(symbol).toUpperCase() : null,
        JSON.stringify(payload || {}),
      ],
      { timeoutMs: 3500, label: 'events.system_events.insert', maxRetries: 0 }
    );

    latestEventLog = {
      status: 'ok',
      last_event_at: new Date().toISOString(),
      events_logged: latestEventLog.events_logged + 1,
      errors: latestEventLog.errors,
    };
  } catch (error) {
    latestEventLog = {
      ...latestEventLog,
      status: 'warning',
      errors: latestEventLog.errors + 1,
    };
    logger.error('[ENGINE ERROR] system event log failed', { error: error.message, event_type });
  }
}

function initEventLogger(eventBus) {
  if (loggerInitialized) return;
  if (!eventBus || typeof eventBus.emit !== 'function') return;

  const originalEmit = eventBus.emit.bind(eventBus);
  eventBus.emit = function patchedEmit(eventType, payload = {}) {
    const normalizedPayload = payload && typeof payload === 'object' ? payload : { value: payload };
    const source = normalizedPayload.source || normalizedPayload.engine || normalizedPayload.provider || 'unknown';
    const symbol = normalizedPayload.symbol || null;

    setImmediate(() => {
      logSystemEvent({
        event_type: eventType,
        source,
        symbol,
        payload: {
          ...normalizedPayload,
          timestamp: normalizedPayload.timestamp || new Date().toISOString(),
        },
      });
    });

    return originalEmit(eventType, normalizedPayload);
  };

  loggerInitialized = true;
  logger.info('[EVENT_LOGGER] initialized');
}

function getEventBusHealth() {
  return {
    logger_initialized: loggerInitialized,
    ...latestEventLog,
  };
}

module.exports = {
  initEventLogger,
  ensureSystemEventsTable,
  logSystemEvent,
  getEventBusHealth,
};
