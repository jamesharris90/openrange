const { queryWithTimeout } = require('./pg');
const logger = require('../logger');

async function ensureColumn(table, column, definition) {
  const sql = `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`;
  await queryWithTimeout(sql, [], {
    timeoutMs: 6000,
    label: `db.schema_guard.${table}.${column}`,
    maxRetries: 0,
  });
}

async function ensureTable(tableSql, label) {
  await queryWithTimeout(tableSql, [], {
    timeoutMs: 7000,
    label,
    maxRetries: 0,
  });
}

async function runDbSchemaGuard() {
  const issues = [];

  try {
    await ensureTable(
      `CREATE TABLE IF NOT EXISTS sparkline_cache (
        symbol TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.sparkline_cache.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS engine_errors (
        id BIGSERIAL PRIMARY KEY,
        engine TEXT NOT NULL,
        message TEXT,
        stack TEXT,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.engine_errors.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS system_events (
        id BIGSERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        source TEXT,
        symbol TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.system_events.table'
    );

    await ensureTable(
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
      'db.schema_guard.data_integrity_events.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS system_alerts (
        id BIGSERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        source TEXT,
        severity TEXT NOT NULL DEFAULT 'medium',
        message TEXT NOT NULL,
        acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.system_alerts.table'
    );

    await ensureColumn('market_quotes', 'short_float', 'NUMERIC');
    await ensureColumn('market_quotes', 'float', 'NUMERIC');
    await ensureColumn('market_quotes', 'relative_volume', 'NUMERIC');
    await ensureColumn('market_quotes', 'premarket_volume', 'NUMERIC');

    await ensureColumn('news_articles', 'sector', 'TEXT');
    await ensureColumn('news_articles', 'catalyst_type', 'TEXT');
    await ensureColumn('news_articles', 'narrative', 'TEXT');

    await ensureColumn('opportunity_stream', 'created_at', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    await ensureColumn('opportunity_stream', 'score', 'NUMERIC');

    await ensureColumn('flow_signals', 'timestamp', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    await ensureColumn('squeeze_signals', 'timestamp', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    await ensureColumn('stocks_in_play', 'detected_at', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()');
  } catch (error) {
    issues.push(error.message);
    logger.warn('[SCHEMA_GUARD_DB] issue', { error: error.message });
  }

  const result = {
    ok: issues.length === 0,
    issues,
    checked_at: new Date().toISOString(),
  };

  logger.info('[SCHEMA_GUARD_DB] complete', result);
  return result;
}

module.exports = {
  ensureColumn,
  runDbSchemaGuard,
};
