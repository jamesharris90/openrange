const { queryWithTimeout } = require('../db/pg');
const { ALL_FEATURE_KEYS } = require('../config/features');

const VALID_ROLES = new Set(['free', 'pro', 'ultimate', 'admin']);
const FEATURE_KEY_SET = new Set(ALL_FEATURE_KEYS);

function toBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeRole(role) {
  const next = String(role || '').trim().toLowerCase();
  return VALID_ROLES.has(next) ? next : null;
}

function normalizeFeatureKey(featureKey) {
  const next = String(featureKey || '').trim();
  return FEATURE_KEY_SET.has(next) ? next : null;
}

async function getUserRole(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) {
    return 'free';
  }

  const direct = await queryWithTimeout(
    `SELECT role
     FROM user_roles
     WHERE user_id = $1
     LIMIT 1`,
    [uid],
    { timeoutMs: 5000, label: 'feature_access.get_user_role.direct', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const dbRole = normalizeRole(direct.rows?.[0]?.role);
  if (dbRole) return dbRole;

  const fallback = await queryWithTimeout(
    `SELECT is_admin
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [uid],
    { timeoutMs: 5000, label: 'feature_access.get_user_role.fallback', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  if (!fallback.rows?.length) return 'free';
  return toBool(fallback.rows[0]?.is_admin) ? 'admin' : 'free';
}

async function getTierDefaults(role) {
  const safeRole = normalizeRole(role) || 'free';

  const result = await queryWithTimeout(
    `SELECT feature_key, enabled
     FROM tier_feature_defaults
     WHERE role = $1`,
    [safeRole],
    { timeoutMs: 5000, label: 'feature_access.get_tier_defaults', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const defaults = {};
  for (const key of ALL_FEATURE_KEYS) defaults[key] = false;
  for (const row of result.rows || []) {
    const key = normalizeFeatureKey(row?.feature_key);
    if (!key) continue;
    defaults[key] = toBool(row?.enabled);
  }
  return defaults;
}

async function getUserFeatureOverrides(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return {};

  const result = await queryWithTimeout(
    `SELECT feature_key, enabled
     FROM user_feature_access
     WHERE user_id = $1`,
    [uid],
    { timeoutMs: 5000, label: 'feature_access.get_overrides', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const overrides = {};
  for (const row of result.rows || []) {
    const key = normalizeFeatureKey(row?.feature_key);
    if (!key) continue;
    overrides[key] = toBool(row?.enabled);
  }
  return overrides;
}

async function getResolvedFeatures(userId) {
  const role = await getUserRole(userId);
  const defaults = await getTierDefaults(role);
  const overrides = await getUserFeatureOverrides(userId);

  return {
    role,
    features: {
      ...defaults,
      ...overrides,
    },
    overrides,
  };
}

async function setUserRole(userId, role, adminUserId) {
  const uid = Number(userId);
  const actorId = Number(adminUserId) || null;
  const nextRole = normalizeRole(role);

  if (!Number.isFinite(uid) || uid <= 0) {
    throw Object.assign(new Error('Invalid userId'), { status: 400 });
  }
  if (!nextRole) {
    throw Object.assign(new Error('Invalid role'), { status: 400 });
  }

  const userCheck = await queryWithTimeout(
    'SELECT id FROM users WHERE id = $1 LIMIT 1',
    [uid],
    { timeoutMs: 5000, label: 'feature_access.set_role.user_check', maxRetries: 0 }
  );
  if (!userCheck.rows.length) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }

  const oldRole = await getUserRole(uid);

  await queryWithTimeout(
    `INSERT INTO user_roles (user_id, role, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET role = EXCLUDED.role, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [uid, nextRole, actorId],
    { timeoutMs: 5000, label: 'feature_access.set_role.upsert', maxRetries: 0 }
  );

  await queryWithTimeout(
    `INSERT INTO feature_access_audit (
      user_id,
      feature_key,
      old_enabled,
      new_enabled,
      old_role,
      new_role,
      action,
      reason,
      changed_by,
      changed_at
    ) VALUES ($1, NULL, NULL, NULL, $2, $3, 'role_update', NULL, $4, NOW())`,
    [uid, oldRole, nextRole, actorId],
    { timeoutMs: 5000, label: 'feature_access.set_role.audit', maxRetries: 0 }
  ).catch(() => null);

  return { userId: uid, oldRole, role: nextRole };
}

async function setUserFeatureOverride(userId, featureKey, enabled, adminUserId, reason) {
  const uid = Number(userId);
  const actorId = Number(adminUserId) || null;
  const key = normalizeFeatureKey(featureKey);
  const nextEnabled = Boolean(enabled);
  const why = reason ? String(reason).slice(0, 500) : null;

  if (!Number.isFinite(uid) || uid <= 0) {
    throw Object.assign(new Error('Invalid userId'), { status: 400 });
  }
  if (!key) {
    throw Object.assign(new Error('Unknown feature key'), { status: 400 });
  }

  const userCheck = await queryWithTimeout(
    'SELECT id FROM users WHERE id = $1 LIMIT 1',
    [uid],
    { timeoutMs: 5000, label: 'feature_access.set_override.user_check', maxRetries: 0 }
  );
  if (!userCheck.rows.length) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }

  const current = await queryWithTimeout(
    `SELECT enabled
     FROM user_feature_access
     WHERE user_id = $1 AND feature_key = $2
     LIMIT 1`,
    [uid, key],
    { timeoutMs: 5000, label: 'feature_access.set_override.current', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const oldEnabled = current.rows.length ? toBool(current.rows[0]?.enabled) : null;

  await queryWithTimeout(
    `INSERT INTO user_feature_access (user_id, feature_key, enabled, reason, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, feature_key)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       reason = EXCLUDED.reason,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [uid, key, nextEnabled, why, actorId],
    { timeoutMs: 5000, label: 'feature_access.set_override.upsert', maxRetries: 0 }
  );

  await queryWithTimeout(
    `INSERT INTO feature_access_audit (
      user_id,
      feature_key,
      old_enabled,
      new_enabled,
      old_role,
      new_role,
      action,
      reason,
      changed_by,
      changed_at
    ) VALUES ($1, $2, $3, $4, NULL, NULL, 'feature_override', $5, $6, NOW())`,
    [uid, key, oldEnabled, nextEnabled, why, actorId],
    { timeoutMs: 5000, label: 'feature_access.set_override.audit', maxRetries: 0 }
  ).catch(() => null);

  return { userId: uid, featureKey: key, enabled: nextEnabled };
}

module.exports = {
  VALID_ROLES,
  getUserRole,
  getTierDefaults,
  getUserFeatureOverrides,
  getResolvedFeatures,
  setUserRole,
  setUserFeatureOverride,
};
