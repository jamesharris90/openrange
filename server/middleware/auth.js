const jwt = require('jsonwebtoken');
const { PROXY_API_KEY, JWT_SECRET } = require('../utils/config');

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
  if (!req.path.startsWith('/api/')) return next();
  if (isPublicPath(req.path)) return next();
  if (req.path.startsWith('/api/earnings-research/')) return next();
  if (req.path.startsWith('/api/ai-quant/')) return next();

  const token = req.get('Authorization')?.replace('Bearer ', '');
  const apiKey = req.get('x-api-key') || req.query['api_key'];

  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      return next();
    } catch (err) {
      // fall through to API key
    }
  }

  if (!PROXY_API_KEY) {
    return res.status(502).json({ error: 'Proxy API key not configured on server' });
  }
  if (!apiKey || apiKey !== PROXY_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - provide valid JWT or API key' });
  }
  return next();
}

module.exports = authMiddleware;
