const express = require('express');
const jwt = require('jsonwebtoken');
const { requireAdminAccess } = require('../middleware/requireAdminAccess');
const {
  VALID_ROLES,
  getResolvedFeatures,
  getUserFeatureOverrides,
  setUserRole,
  setUserFeatureOverride,
} = require('../services/featureAccessService');
const { FEATURE_REGISTRY, ALL_FEATURE_KEYS } = require('../config/features');
const { queryWithTimeout } = require('../db/pg');
const { runFeatureBootstrap } = require('../system/featureBootstrap');
const { safeQuery } = require('../utils/safeQuery');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
let bootstrapPromise = null;

function withContract(payload = {}, status = 'ok') {
  return { ok: true, status, data: payload, ...payload };
}

const sqlDb = {
  query: (sql, params = []) => queryWithTimeout(sql, params, {
    timeoutMs: 7000,
    label: 'admin_feature_access.safe_query',
    maxRetries: 0,
  }),
};

async function safeCall(fn, fallback = null, label = 'admin_feature_access.query') {
  try {
    return await fn();
  } catch (err) {
    console.error(`[QUERY ERROR] ${label}`, err?.message || err);
    return fallback;
  }
}

async function tableExists(tableName) {
  const rows = await safeQuery(sqlDb, 'SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${tableName}`]);
  return Boolean(rows?.[0]?.exists);
}

async function ensureFeatureBootstrapReady() {
  if (!bootstrapPromise) {
    bootstrapPromise = runFeatureBootstrap().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  await bootstrapPromise;
}

function getToken(req) {
  const header = req.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function getAuthUser(req) {
  if (req?.user?.id) return req.user;
  const token = getToken(req);
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    return null;
  }
}

function groupRegistry() {
  const grouped = {};
  for (const item of FEATURE_REGISTRY) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }
  return grouped;
}

router.get('/api/features/me', async (req, res) => {
  const user = getAuthUser(req);
  if (!user?.id) {
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }

  try {
    const resolved = await getResolvedFeatures(user.id);
    return res.json({ ok: true, ...resolved });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to resolve feature access', detail: error.message });
  }
});

router.get('/api/admin/features/registry', requireAdminAccess, async (_req, res) => {
  return res.json(withContract({ features: FEATURE_REGISTRY, grouped: groupRegistry() }));
});

router.get('/api/admin/features/users', requireAdminAccess, async (_req, res) => {
  try {
    await safeCall(() => ensureFeatureBootstrapReady(), null, 'admin_feature_access.bootstrap.users');

    if (!(await tableExists('users'))) {
      return res.json(withContract({ items: [] }, 'warning'));
    }

    const hasUserRolesTable = await tableExists('user_roles');
    if (!hasUserRolesTable) {
      const rows = await safeQuery(
        sqlDb,
        `SELECT
           u.id,
           u.username,
           u.email,
           CASE WHEN COALESCE(u.is_admin, 0) = 1 THEN 'admin' ELSE 'free' END AS role,
           u.is_active,
           u.created_at
         FROM users u
         ORDER BY u.created_at DESC NULLS LAST`,
        []
      );
      return res.json(withContract({ items: rows || [] }, 'warning'));
    }

    const rows = await safeQuery(
      sqlDb,
      `SELECT
         u.id,
         u.username,
         u.email,
         COALESCE(ur.role, CASE WHEN COALESCE(u.is_admin, 0) = 1 THEN 'admin' ELSE 'free' END) AS role,
         u.is_active,
         u.created_at
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       ORDER BY u.created_at DESC NULLS LAST`,
      []
    );

    return res.json(withContract({ items: rows || [] }));
  } catch (_error) {
    return res.json(withContract({ items: [] }, 'warning'));
  }
});

router.get('/api/admin/features/user/:userId', requireAdminAccess, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid userId' });
  }

  try {
    await safeCall(() => ensureFeatureBootstrapReady(), null, 'admin_feature_access.bootstrap.user');

    if (!(await tableExists('users'))) {
      return res.json(withContract({ user: null, role: 'free', features: {}, overrides: {}, registry: FEATURE_REGISTRY }, 'warning'));
    }

    const userRows = await safeQuery(sqlDb, 'SELECT id, username, email FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (!userRows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const resolved = await getResolvedFeatures(userId);
    const overrides = await getUserFeatureOverrides(userId);

    return res.json(withContract({
      user: userRows[0],
      role: resolved.role,
      features: resolved.features,
      overrides,
      registry: FEATURE_REGISTRY,
    }));
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load user feature data', detail: error.message });
  }
});

router.patch('/api/admin/features/user/:userId/role', requireAdminAccess, async (req, res) => {
  const userId = Number(req.params.userId);
  const role = String(req.body?.role || '').trim().toLowerCase();

  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid userId' });
  }

  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ ok: false, error: 'Invalid role' });
  }

  try {
    await safeCall(() => ensureFeatureBootstrapReady(), null, 'admin_feature_access.bootstrap.role');
    const result = await setUserRole(userId, role, req.user.id);
    return res.json(withContract({ result }));
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message || 'Failed to update role' });
  }
});

router.patch('/api/admin/features/user/:userId/feature', requireAdminAccess, async (req, res) => {
  const userId = Number(req.params.userId);
  const featureKey = String(req.body?.featureKey || '').trim();
  const enabled = req.body?.enabled;
  const reason = req.body?.reason || null;

  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid userId' });
  }

  if (!ALL_FEATURE_KEYS.includes(featureKey)) {
    return res.status(400).json({ ok: false, error: 'Unknown feature key' });
  }

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ ok: false, error: 'enabled must be boolean' });
  }

  try {
    await safeCall(() => ensureFeatureBootstrapReady(), null, 'admin_feature_access.bootstrap.feature');
    const result = await setUserFeatureOverride(userId, featureKey, enabled, req.user.id, reason);
    return res.json(withContract({ result }));
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message || 'Failed to update feature override' });
  }
});

async function handleFeatureAudit(_req, res) {
  try {
    await safeCall(() => ensureFeatureBootstrapReady(), null, 'admin_feature_access.bootstrap.audit');
    if (!(await tableExists('feature_access_audit'))) {
      return res.json(withContract({ items: [] }, 'warning'));
    }

    const rows = await safeQuery(
      sqlDb,
      `SELECT
         fa.id,
         fa.user_id,
         u.username,
         u.email,
         fa.feature_key,
         fa.old_enabled,
         fa.new_enabled,
         fa.old_role,
         fa.new_role,
         fa.action,
         fa.reason,
         fa.changed_by,
         actor.username AS actor_username,
         fa.changed_at
       FROM feature_access_audit fa
       LEFT JOIN users u ON u.id = fa.user_id
       LEFT JOIN users actor ON actor.id = fa.changed_by
       ORDER BY fa.changed_at DESC
       LIMIT 200`,
      []
    );

    return res.json(withContract({ items: rows || [] }));
  } catch (_error) {
    return res.json(withContract({ items: [] }, 'warning'));
  }
}

router.get('/api/admin/features/audit', requireAdminAccess, handleFeatureAudit);
router.get('/api/features/audit', requireAdminAccess, handleFeatureAudit);

router.get('/api/admin/features/newsletter/summary', requireAdminAccess, async (_req, res) => {
  try {
    const hasSubscribers = await tableExists('newsletter_subscribers');
    const hasHistory = await tableExists('newsletter_send_history');

    const subscriberRows = hasSubscribers
      ? await safeQuery(sqlDb, `SELECT COUNT(*)::int AS total FROM newsletter_subscribers WHERE is_active = TRUE`, [])
      : [{ total: 0 }];
    const historyRows = hasHistory
      ? await safeQuery(sqlDb, `SELECT sent_at, recipients_count, open_rate, click_rate, status FROM newsletter_send_history ORDER BY sent_at DESC NULLS LAST LIMIT 20`, [])
      : [];

    return res.json(withContract({
      subscriberCount: subscriberRows?.[0]?.total || 0,
      campaigns: historyRows || [],
    }, (!hasSubscribers && !hasHistory) ? 'warning' : 'ok'));
  } catch (_error) {
    return res.json(withContract({ subscriberCount: 0, campaigns: [] }, 'warning'));
  }
});

module.exports = router;
