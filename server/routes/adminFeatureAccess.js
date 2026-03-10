const express = require('express');
const jwt = require('jsonwebtoken');
const requireAdmin = require('../middleware/requireAdmin');
const {
  VALID_ROLES,
  getResolvedFeatures,
  getUserFeatureOverrides,
  setUserRole,
  setUserFeatureOverride,
} = require('../services/featureAccessService');
const { FEATURE_REGISTRY, ALL_FEATURE_KEYS } = require('../config/features');
const { queryWithTimeout } = require('../db/pg');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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

router.get('/api/admin/features/registry', requireAdmin, async (_req, res) => {
  return res.json({
    ok: true,
    features: FEATURE_REGISTRY,
    grouped: groupRegistry(),
  });
});

router.get('/api/admin/features/users', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
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
      [],
      { timeoutMs: 7000, label: 'admin_feature_access.users', maxRetries: 0 }
    );

    return res.json({ ok: true, items: rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load users', detail: error.message });
  }
});

router.get('/api/admin/features/user/:userId', requireAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid userId' });
  }

  try {
    const userCheck = await queryWithTimeout(
      'SELECT id, username, email FROM users WHERE id = $1 LIMIT 1',
      [userId],
      { timeoutMs: 5000, label: 'admin_feature_access.user.check', maxRetries: 0 }
    );

    if (!userCheck.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const resolved = await getResolvedFeatures(userId);
    const overrides = await getUserFeatureOverrides(userId);

    return res.json({
      ok: true,
      user: userCheck.rows[0],
      role: resolved.role,
      features: resolved.features,
      overrides,
      registry: FEATURE_REGISTRY,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load user feature data', detail: error.message });
  }
});

router.patch('/api/admin/features/user/:userId/role', requireAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  const role = String(req.body?.role || '').trim().toLowerCase();

  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid userId' });
  }

  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ ok: false, error: 'Invalid role' });
  }

  try {
    const result = await setUserRole(userId, role, req.user.id);
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message || 'Failed to update role' });
  }
});

router.patch('/api/admin/features/user/:userId/feature', requireAdmin, async (req, res) => {
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
    const result = await setUserFeatureOverride(userId, featureKey, enabled, req.user.id, reason);
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message || 'Failed to update feature override' });
  }
});

router.get('/api/admin/features/audit', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
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
      [],
      { timeoutMs: 7000, label: 'admin_feature_access.audit', maxRetries: 0 }
    );

    return res.json({ ok: true, items: rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load audit trail', detail: error.message });
  }
});

router.get('/api/admin/features/newsletter/summary', requireAdmin, async (_req, res) => {
  try {
    const [subscriberResult, historyResult] = await Promise.all([
      queryWithTimeout(
        `SELECT COUNT(*)::int AS total
         FROM newsletter_subscribers
         WHERE is_active = TRUE`,
        [],
        { timeoutMs: 7000, label: 'admin_feature_access.newsletter.subscribers', maxRetries: 0 }
      ).catch(() => ({ rows: [{ total: 0 }] })),
      queryWithTimeout(
        `SELECT sent_at, recipients_count, open_rate, click_rate, status
         FROM newsletter_send_history
         ORDER BY sent_at DESC NULLS LAST
         LIMIT 20`,
        [],
        { timeoutMs: 7000, label: 'admin_feature_access.newsletter.history', maxRetries: 0 }
      ).catch(() => ({ rows: [] })),
    ]);

    return res.json({
      ok: true,
      subscriberCount: subscriberResult.rows?.[0]?.total || 0,
      campaigns: historyResult.rows || [],
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to load newsletter summary', detail: error.message });
  }
});

module.exports = router;
