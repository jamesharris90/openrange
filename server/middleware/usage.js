const usage = require('../utils/usageStore');

function usageMiddleware(req, _res, next) {
  if (req.path.startsWith('/api/')) {
    const user = req.user?.username || 'anon';
    usage.record(req.path, user);
  }
  next();
}

module.exports = usageMiddleware;
