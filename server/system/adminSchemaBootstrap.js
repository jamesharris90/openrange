const { queryWithTimeout } = require('../db/pg');

async function ensureAdminSchema() {
  // Core admin/system tables required by monitor and admin APIs.
  const tableStatements = [
    `CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT,
      email TEXT,
      is_admin BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS feature_flags (
      id BIGSERIAL PRIMARY KEY,
      feature_key TEXT UNIQUE,
      enabled BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS feature_roles (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT,
      role TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS feature_audit (
      id BIGSERIAL PRIMARY KEY,
      actor_id BIGINT,
      action TEXT,
      target TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS engine_runtime (
      id BIGSERIAL PRIMARY KEY,
      engine_name TEXT,
      status TEXT,
      execution_time_ms INTEGER,
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS engine_errors (
      id BIGSERIAL PRIMARY KEY,
      engine_name TEXT,
      error TEXT,
      severity TEXT DEFAULT 'warning',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS integrity_events (
      id BIGSERIAL PRIMARY KEY,
      source TEXT,
      issue TEXT,
      severity TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS alerts (
      id BIGSERIAL PRIMARY KEY,
      type TEXT,
      source TEXT,
      severity TEXT,
      message TEXT,
      acknowledged BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS provider_health (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT,
      status TEXT,
      detail TEXT,
      checked_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];

  for (const sql of tableStatements) {
    await queryWithTimeout(sql, [], {
      label: 'admin_schema_bootstrap.create_table',
      timeoutMs: 7000,
      maxRetries: 1,
      retryDelayMs: 150,
    });
  }

  const columnStatements = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS category TEXT`,
    `ALTER TABLE feature_roles ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE feature_audit ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE engine_runtime ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE engine_errors ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`,
    `ALTER TABLE integrity_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE provider_health ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
  ];

  for (const sql of columnStatements) {
    await queryWithTimeout(sql, [], {
      label: 'admin_schema_bootstrap.add_column',
      timeoutMs: 7000,
      maxRetries: 1,
      retryDelayMs: 150,
    });
  }

  return { ok: true };
}

module.exports = {
  ensureAdminSchema,
};
