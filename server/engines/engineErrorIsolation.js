const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

async function ensureEngineErrorsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS engine_errors (
      id BIGSERIAL PRIMARY KEY,
      engine TEXT NOT NULL,
      message TEXT,
      stack TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 6000, label: 'engine_errors.ensure_table', maxRetries: 0 }
  );
}

async function recordEngineError(engine, error) {
  const timestamp = new Date().toISOString();
  const message = String(error?.message || 'Unknown engine error');
  const stack = String(error?.stack || '');

  logger.error('[ENGINE ERROR]', {
    engine_name: engine,
    timestamp,
    message,
  });

  try {
    await ensureEngineErrorsTable();
    await queryWithTimeout(
      `INSERT INTO engine_errors (engine, message, stack, timestamp)
       VALUES ($1, $2, $3, NOW())`,
      [engine, message, stack],
      { timeoutMs: 3000, label: `engine_errors.insert.${engine}`, maxRetries: 0 }
    );
  } catch (persistError) {
    logger.error('[ENGINE ERROR]', {
      engine_name: `${engine}:engine_error_persist`,
      timestamp: new Date().toISOString(),
      message: persistError.message,
    });
  }
}

async function runIsolated(engine, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return {
      ok: !(result && result.ok === false),
      result,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
      error: result?.error || null,
    };
  } catch (error) {
    await recordEngineError(engine, error);
    return {
      ok: false,
      result: null,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
      error: error.message,
    };
  }
}

module.exports = {
  ensureEngineErrorsTable,
  recordEngineError,
  runIsolated,
};
