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

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT,
        role TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.users.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS feature_registry (
        feature_key TEXT PRIMARY KEY,
        category TEXT,
        display_name TEXT,
        is_beta BOOLEAN NOT NULL DEFAULT FALSE,
        is_internal BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.feature_registry.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS feature_overrides (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        feature_key TEXT,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.feature_overrides.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS trade_setups (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        setup_type TEXT,
        score NUMERIC,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.trade_setups.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS opportunity_stream (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        event_type TEXT,
        headline TEXT,
        score NUMERIC,
        source TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.opportunity_stream.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS market_quotes (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT UNIQUE,
        price NUMERIC,
        change_percent NUMERIC,
        volume BIGINT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.market_quotes.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS news_articles (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT,
        headline TEXT,
        source TEXT,
        sentiment TEXT,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.news_articles.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        role TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.roles.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        actor TEXT,
        action TEXT,
        target TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.audit_log.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS engine_telemetry (
        id BIGSERIAL PRIMARY KEY,
        engine TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.engine_telemetry.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS event_log (
        id BIGSERIAL PRIMARY KEY,
        event_type TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.event_log.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS data_integrity (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT,
        issue TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.data_integrity.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS opportunities (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT,
        score NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.opportunities.table'
    );

    await ensureTable(
      `CREATE TABLE IF NOT EXISTS provider_health (
        id BIGSERIAL PRIMARY KEY,
        provider TEXT,
        status TEXT,
        latency NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'db.schema_guard.provider_health.table'
    );

    await ensureColumn('market_quotes', 'market_cap', 'BIGINT');
    await ensureColumn('market_quotes', 'sector', 'TEXT');
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
    await ensureColumn('users', 'email', 'TEXT');
    await ensureColumn('users', 'role', 'TEXT');
    await ensureColumn('users', 'created_at', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()');
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
