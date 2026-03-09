const jwt = require('jsonwebtoken');
const { ALL_FEATURE_KEYS } = require('../config/features');
const { getResolvedFeatures } = require('../services/featureAccessService');
const { queryWithTimeout } = require('../db/pg');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const FEATURE_KEY_SET = new Set(ALL_FEATURE_KEYS);

function getToken(req) {
  const header = req.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function decodeToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    return null;
  }
}

function asAdminFlag(value) {
  return value === 1 || value === true || value === '1' || value === 'true';
}

async function loadAuthUser(userId, fallbackUser = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const withPlan = await queryWithTimeout(
    `SELECT
       id,
       username,
       email,
       is_admin,
       COALESCE(NULLIF(TRIM(plan), ''), CASE WHEN COALESCE(is_admin, 0) = 1 THEN 'admin' ELSE 'free' END) AS plan
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [id],
    { timeoutMs: 5000, label: 'require_feature.load_user.with_plan', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  if (withPlan.rows?.length) {
    const row = withPlan.rows[0];
    return {
      id: Number(row.id),
      username: row.username,
      email: row.email,
      is_admin: asAdminFlag(row.is_admin) ? 1 : 0,
      plan: String(row.plan || '').toLowerCase() || 'free',
    };
  }

  const fallback = await queryWithTimeout(
    `SELECT id, username, email, is_admin
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [id],
    { timeoutMs: 5000, label: 'require_feature.load_user.fallback', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  if (!fallback.rows?.length) {
    return {
      id,
      username: fallbackUser.username,
      email: fallbackUser.email,
      is_admin: asAdminFlag(fallbackUser.is_admin) ? 1 : 0,
      plan: String(fallbackUser.plan || '').toLowerCase() || (asAdminFlag(fallbackUser.is_admin) ? 'admin' : 'free'),
    };
  }

  const row = fallback.rows[0];
  const isAdmin = asAdminFlag(row.is_admin) ? 1 : 0;
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    is_admin: isAdmin,
    plan: isAdmin ? 'admin' : 'free',
  };
}

async function checkFeatureAccess(userId, featureKey) {
  const resolved = await getResolvedFeatures(userId);
  return {
    hasAccess: Boolean(resolved?.features?.[featureKey]),
    resolved,
  };
}

function requireFeature(featureKey) {
  const key = String(featureKey || '').trim();
  if (!FEATURE_KEY_SET.has(key)) {
    throw new Error(`Unknown feature key: ${key}`);
  }

  return async function featureGuard(req, res, next) {
    const tokenUser = decodeToken(getToken(req));
    const user = req.user || tokenUser;

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const hydratedUser = await loadAuthUser(user.id, user);

    if (!hydratedUser?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = hydratedUser;

    console.log('Feature gate check', {
      user: req.user?.username,
      plan: req.user?.plan,
      admin: req.user?.is_admin,
    });

    if (req.user?.is_admin === 1 || req.user?.plan === 'admin') {
      return next();
    }

    try {
      const { hasAccess, resolved } = await checkFeatureAccess(req.user.id, key);

      req.featureAccess = resolved;

      if (!hasAccess) {
        return res.status(403).json({
          error: 'This feature is not included in your plan',
        });
      }

      return next();
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to evaluate feature access', detail: error.message });
    }
  };
}

module.exports = requireFeature;
