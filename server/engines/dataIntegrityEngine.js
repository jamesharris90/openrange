const { queryWithTimeout } = require('../db/pg');
const EVENT_TYPES = require('../events/eventTypes');
const eventBus = require('../events/eventBus');
const logger = require('../logger');
const { runCandleIntegrityEngine } = require('./candleIntegrityEngine');
const { runPriceAnomalyEngine } = require('./priceAnomalyEngine');
const { runDuplicateTickEngine } = require('./duplicateTickEngine');
const { runProviderCrossCheckEngine } = require('./providerCrossCheckEngine');

const EVENTS_TABLE_RECHECK_MS = 5 * 60 * 1000;

let latestIntegrityRun = {
  status: 'idle',
  last_run: null,
  execution_time_ms: 0,
  checks: {},
  issues: [],
};

let eventsTableState = {
  ready: false,
  checked_at: null,
  error: null,
  promise: null,
};

async function ensureDataIntegrityEventsTable() {
  const now = Date.now();
  const checkedAtMs = eventsTableState.checked_at ? Date.parse(eventsTableState.checked_at) : 0;
  const recentlyChecked = checkedAtMs && Number.isFinite(checkedAtMs) && (now - checkedAtMs) < EVENTS_TABLE_RECHECK_MS;

  if (eventsTableState.ready && recentlyChecked) {
    return true;
  }

  if (eventsTableState.promise) {
    return eventsTableState.promise;
  }

  eventsTableState.promise = (async () => {
    try {
      await queryWithTimeout(
        `CREATE TABLE IF NOT EXISTS data_integrity_events (
          id BIGSERIAL PRIMARY KEY,
          event_type TEXT NOT NULL,
          source TEXT,
          symbol TEXT,
          issue TEXT,
          severity TEXT,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
        [],
        { timeoutMs: 7000, label: 'integrity.events.ensure_table', maxRetries: 0 }
      );

      eventsTableState = {
        ready: true,
        checked_at: new Date().toISOString(),
        error: null,
        promise: null,
      };

      return true;
    } catch (error) {
      logger.warn('[ENGINE WARN] data_integrity_engine persistence unavailable', { error: error.message });

      eventsTableState = {
        ready: false,
        checked_at: new Date().toISOString(),
        error: error.message,
        promise: null,
      };

      return false;
    }
  })();

  return eventsTableState.promise;
}

async function writeIntegrityEvent(issue) {
  const persistenceReady = await ensureDataIntegrityEventsTable();
  if (!persistenceReady) {
    return false;
  }

  try {
    await queryWithTimeout(
      `INSERT INTO data_integrity_events (event_type, source, symbol, issue, severity, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
      [
        EVENT_TYPES.DATA_INTEGRITY_WARNING,
        String(issue?.source || 'data_integrity_engine'),
        issue?.symbol ? String(issue.symbol).toUpperCase() : null,
        String(issue?.issue || 'integrity_warning'),
        String(issue?.severity || 'medium'),
        JSON.stringify(issue || {}),
      ],
      { timeoutMs: 3500, label: 'integrity.events.insert', maxRetries: 0 }
    );
    return true;
  } catch (error) {
    logger.warn('[ENGINE WARN] data_integrity_engine event persistence failed', {
      error: error.message,
      issue: String(issue?.issue || 'integrity_warning'),
      symbol: issue?.symbol ? String(issue.symbol).toUpperCase() : null,
    });

    eventsTableState = {
      ready: false,
      checked_at: new Date().toISOString(),
      error: error.message,
      promise: null,
    };

    return false;
  }
}

async function runDataIntegrityEngine() {
  const startedAt = Date.now();
  const checks = {};
  const issues = [];
  const persistence = {
    status: 'ok',
    persisted_issue_count: 0,
    dropped_issue_count: 0,
    last_error: null,
  };

  try {
    const candle = await runCandleIntegrityEngine();
    checks.candle_integrity = candle;
    issues.push(...(candle.warnings || []));

    const anomaly = await runPriceAnomalyEngine();
    checks.price_anomaly = anomaly;
    issues.push(...(anomaly.anomalies || []));

    const duplicate = await runDuplicateTickEngine();
    checks.duplicate_tick = duplicate;
    issues.push(...(duplicate.events || []));

    const crosscheck = await runProviderCrossCheckEngine();
    checks.provider_crosscheck = crosscheck;
    issues.push(...(crosscheck.discrepancies || []));

    for (const issue of issues) {
      eventBus.emit(EVENT_TYPES.DATA_INTEGRITY_WARNING, {
        source: issue.source || 'data_integrity_engine',
        ...issue,
        timestamp: issue.timestamp || new Date().toISOString(),
      });

      const persisted = await writeIntegrityEvent(issue);
      if (persisted) {
        persistence.persisted_issue_count += 1;
      } else {
        persistence.status = 'degraded';
        persistence.dropped_issue_count += 1;
        persistence.last_error = eventsTableState.error || 'integrity event persistence unavailable';
      }
    }

    latestIntegrityRun = {
      status: issues.length > 0 ? 'warning' : 'ok',
      last_run: new Date().toISOString(),
      execution_time_ms: Date.now() - startedAt,
      checks,
      issues,
      persistence,
    };

    return {
      ok: true,
      ...latestIntegrityRun,
    };
  } catch (error) {
    logger.error('[ENGINE ERROR] data_integrity_engine failed', { error: error.message });
    eventBus.emit(EVENT_TYPES.ENGINE_FAILURE, {
      source: 'data_integrity_engine',
      issue: 'engine_failure',
      severity: 'high',
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    latestIntegrityRun = {
      status: 'failed',
      last_run: new Date().toISOString(),
      execution_time_ms: Date.now() - startedAt,
      checks,
      issues,
      persistence: {
        ...persistence,
        status: 'degraded',
        last_error: error.message,
      },
      error: error.message,
    };

    return {
      ok: false,
      ...latestIntegrityRun,
      error: error.message,
    };
  }
}

function getDataIntegrityHealth() {
  return latestIntegrityRun;
}

module.exports = {
  ensureDataIntegrityEventsTable,
  runDataIntegrityEngine,
  getDataIntegrityHealth,
};
