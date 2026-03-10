const jwt = require('jsonwebtoken');
const { getUserRole } = require('../services/featureAccessService');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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

async function requireAdmin(req, res, next) {
  const tokenUser = decodeToken(getToken(req));
  const user = req.user || tokenUser;

  if (!user?.id) {
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }

  req.user = user;

  try {
    const role = await getUserRole(user.id);
    if (role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin access required' });
    }

    req.userRole = role;
    return next();
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Failed to evaluate admin role', detail: error.message });
  }
}

module.exports = requireAdmin;
