const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../utils/config');

const publicPaths = new Set([
  '/api/finviz/screener',
  '/api/finviz/news-scanner',
  '/api/finviz/quote',
  '/api/finviz/news',
  '/api/gappers',
  '/api/news',
  '/api/news/snippet',
  '/api/premarket/report',
  '/api/premarket/report-md',
  '/api/scanner/status',
  '/api/yahoo/quote',
  '/api/yahoo/quote-batch',
  '/api/yahoo/options',
  '/api/yahoo/history',
  '/api/yahoo/search',
  '/api/earnings/calendar',
  '/api/finnhub/news/symbol',
  '/api/expected-move-enhanced'
]);

// Treat any /api/finviz/* path as public to avoid accidental auth blocks
function isPublicPath(path) {
  if (publicPaths.has(path)) return true;
  if (path.startsWith('/api/finviz/')) return true;
  return false;
}

function authMiddleware(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  if (isPublicPath(req.path)) return next();

  const token = req.get('Authorization')?.replace('Bearer ', '');
  if (!token) return next();

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    console.log('[AUTH] verified user:', payload?.id || payload?.sub || 'unknown', 'path:', req.path);
  } catch (err) {
    console.warn('[AUTH] invalid token for path:', req.path, '—', err.message);
  }

  return next();
}

module.exports = authMiddleware;
