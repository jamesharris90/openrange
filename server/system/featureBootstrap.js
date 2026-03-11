const { queryWithTimeout } = require('../db/pg');
const { FEATURE_REGISTRY, ALL_FEATURE_KEYS } = require('../config/features');

const ROLE_DEFAULTS = {
  free: new Set([
    'dashboard',
    'scanner_page',
    'intel_inbox',
    'expected_move',
    'earnings_calendar',
  ]),
  pro: new Set([
    'dashboard',
    'scanner_page',
    'intel_inbox',
    'expected_move',
    'earnings_calendar',
    'full_screener',
    'alerts',
    'sector_heatmap',
    'premarket_command',
    'open_market_radar',
    'post_market_review',
    'strategy_evaluation',
  ]),
  ultimate: new Set([
    'dashboard',
    'scanner_page',
    'intel_inbox',
    'expected_move',
    'earnings_calendar',
    'full_screener',
    'alerts',
    'sector_heatmap',
    'premarket_command',
    'open_market_radar',
    'post_market_review',
    'strategy_evaluation',
    'trading_cockpit',
  ]),
  admin: new Set(ALL_FEATURE_KEYS),
};

function getTierDefaultRows() {
  const rows = [];
  for (const role of Object.keys(ROLE_DEFAULTS)) {
    for (const key of ALL_FEATURE_KEYS) {
      rows.push({ role, featureKey: key, enabled: ROLE_DEFAULTS[role].has(key) });
    }
  }
  return rows;
}

async function ensureFeatureTables() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS feature_registry (
      feature_key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_beta BOOLEAN NOT NULL DEFAULT FALSE,
      is_internal BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'feature_bootstrap.registry', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS user_roles (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('free', 'pro', 'ultimate', 'admin')),
      updated_by BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'feature_bootstrap.user_roles', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS user_feature_access (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feature_key TEXT NOT NULL REFERENCES feature_registry(feature_key) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL,
      reason TEXT,
      updated_by BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, feature_key)
    )`,
    [],
    { timeoutMs: 7000, label: 'feature_bootstrap.user_feature_access', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS feature_access_audit (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      feature_key TEXT,
      old_enabled BOOLEAN,
      new_enabled BOOLEAN,
      old_role TEXT,
      new_role TEXT,
      action TEXT NOT NULL,
      reason TEXT,
      changed_by BIGINT,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'feature_bootstrap.audit', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE feature_access_audit ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    [],
    { timeoutMs: 7000, label: 'feature_bootstrap.audit.changed_at', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_feature_access_audit_changed_at ON feature_access_audit(changed_at DESC);
     CREATE INDEX IF NOT EXISTS idx_user_feature_access_user_id ON user_feature_access(user_id);
     CREATE INDEX IF NOT EXISTS idx_user_feature_access_feature_key ON user_feature_access(feature_key);`,
    [],
    { timeoutMs: 7000, label: 'feature_bootstrap.indexes', maxRetries: 0 }
  );
}

async function seedFeatureRegistry() {
  for (const feature of FEATURE_REGISTRY) {
    await queryWithTimeout(
      `INSERT INTO feature_registry (feature_key, category, display_name, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (feature_key)
       DO UPDATE SET category = EXCLUDED.category, display_name = EXCLUDED.display_name, updated_at = NOW()`,
      [feature.key, feature.category, feature.label],
      { timeoutMs: 5000, label: 'feature_bootstrap.seed_registry', maxRetries: 0 }
    );
  }
}

async function ensureTierDefaultsView() {
  const rows = getTierDefaultRows();
  const values = rows
    .map((row) => `('${row.role}', '${row.featureKey}', ${row.enabled ? 'TRUE' : 'FALSE'})`)
    .join(',\n');

  await queryWithTimeout(
    `CREATE OR REPLACE VIEW tier_feature_defaults AS
     SELECT role, feature_key, enabled
     FROM (
       VALUES
       ${values}
     ) AS defaults(role, feature_key, enabled)`,
    [],
    { timeoutMs: 7000, label: 'feature_bootstrap.defaults_view', maxRetries: 0 }
  );
}

async function seedUserRoles() {
  await queryWithTimeout(
    `INSERT INTO user_roles (user_id, role, created_at, updated_at)
     SELECT u.id,
            CASE WHEN COALESCE(u.is_admin, 0) = 1 THEN 'admin' ELSE 'free' END,
            NOW(),
            NOW()
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.user_id IS NULL`,
    [],
    { timeoutMs: 7000, label: 'feature_bootstrap.seed_roles', maxRetries: 0 }
  );
}

async function runFeatureBootstrap() {
  // Keep bootstrap additive and non-destructive: ensure support tables and seed defaults.
  await ensureFeatureTables();
  await seedFeatureRegistry();
  await ensureTierDefaultsView();
  await seedUserRoles();
}

module.exports = {
  runFeatureBootstrap,
};
