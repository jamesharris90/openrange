const jwt = require('jsonwebtoken');
const { getUserRole } = require('../services/featureAccessService');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

function getAdminApiKey() {
  return String(process.env.ADMIN_API_KEY || process.env.PROXY_API_KEY || '').trim();
}

function getToken(req) {
  const header = String(req.get('Authorization') || '');
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

function isPayloadAdmin(user) {
  if (!user) return false;
  return (
    user.role === 'admin' ||
    user.is_admin === true ||
    user.is_admin === 1 ||
    user.is_admin === '1'
  );
}

async function hasAdminAccess(req) {
  const configuredApiKey = getAdminApiKey();
  const providedApiKey = String(req.headers['x-api-key'] || '').trim();

  if (configuredApiKey && providedApiKey && providedApiKey === configuredApiKey) {
    return { ok: true, mode: 'api_key', user: null, role: 'admin' };
  }

  const tokenUser = req.user || decodeToken(getToken(req));
  if (!tokenUser?.id) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  req.user = tokenUser;

  try {
    const role = await getUserRole(tokenUser.id);
    if (role === 'admin') {
      req.userRole = role;
      return { ok: true, mode: 'jwt', user: tokenUser, role };
    }
  } catch (_error) {
    if (isPayloadAdmin(tokenUser)) {
      req.userRole = 'admin';
      return { ok: true, mode: 'jwt', user: tokenUser, role: 'admin' };
    }
    return { ok: false, status: 500, error: 'Failed to evaluate admin role' };
  }

  if (isPayloadAdmin(tokenUser)) {
    req.userRole = 'admin';
    return { ok: true, mode: 'jwt', user: tokenUser, role: 'admin' };
  }

  return { ok: false, status: 403, error: 'Admin access required' };
}

async function requireAdminAccess(req, res, next) {
  const access = await hasAdminAccess(req);
  if (!access.ok) {
    return res.status(access.status || 401).json({ ok: false, error: access.error || 'Unauthorized' });
  }

  req.adminAccessMode = access.mode;
  return next();
}

module.exports = {
  requireAdminAccess,
  hasAdminAccess,
};
