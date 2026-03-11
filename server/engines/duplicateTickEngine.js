const { queryWithTimeout } = require('../db/pg');
const EVENT_TYPES = require('../events/eventTypes');
const eventBus = require('../events/eventBus');
const logger = require('../logger');

async function runDuplicateTickEngine() {
  const startedAt = Date.now();
  try {
    const [intradayDupes, quoteDupes] = await Promise.all([
      queryWithTimeout(
        `SELECT symbol, timestamp, COUNT(*)::int AS duplicates
         FROM intraday_1m
         GROUP BY symbol, timestamp
         HAVING COUNT(*) > 1
         ORDER BY COUNT(*) DESC
         LIMIT 100`,
        [],
        { timeoutMs: 6000, label: 'integrity.duplicate.intraday', maxRetries: 0 }
      ),
      queryWithTimeout(
        `SELECT symbol, COUNT(*)::int AS duplicates
         FROM market_quotes
         GROUP BY symbol
         HAVING COUNT(*) > 1
         ORDER BY COUNT(*) DESC
         LIMIT 100`,
        [],
        { timeoutMs: 4000, label: 'integrity.duplicate.quotes', maxRetries: 0 }
      ),
    ]);

    const events = [];

    for (const row of intradayDupes.rows || []) {
      const payload = {
        source: 'duplicate_tick_engine',
        symbol: String(row.symbol || '').toUpperCase(),
        issue: 'intraday_duplicate_tick',
        duplicates: Number(row.duplicates || 0),
        timestamp_value: row.timestamp,
        severity: 'medium',
        timestamp: new Date().toISOString(),
      };
      events.push(payload);
      eventBus.emit(EVENT_TYPES.DUPLICATE_TICK, payload);
      eventBus.emit(EVENT_TYPES.DATA_INTEGRITY_WARNING, payload);
    }

    for (const row of quoteDupes.rows || []) {
      const payload = {
        source: 'duplicate_tick_engine',
        symbol: String(row.symbol || '').toUpperCase(),
        issue: 'market_quote_duplicate',
        duplicates: Number(row.duplicates || 0),
        severity: 'medium',
        timestamp: new Date().toISOString(),
      };
      events.push(payload);
      eventBus.emit(EVENT_TYPES.DUPLICATE_TICK, payload);
      eventBus.emit(EVENT_TYPES.DATA_INTEGRITY_WARNING, payload);
    }

    return {
      ok: true,
      duplicates_found: events.length,
      events,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('[ENGINE ERROR] duplicate_tick_engine failed', { error: error.message });
    return {
      ok: false,
      duplicates_found: 0,
      events: [],
      error: error.message,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
    };
  }
}

module.exports = {
  runDuplicateTickEngine,
};
