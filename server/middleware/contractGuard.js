function contractGuard(req, res, next) {
  const originalJson = res.json;

  res.json = function jsonWithContractGuard(body) {
    const validStatuses = new Set(['ok', 'no_data', 'error']);
    const status = body && typeof body === 'object' ? String(body.status || '') : '';
    const hasSource = body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'source');
    const hasDataWhenRequired = status !== 'ok' || (body && typeof body === 'object' && Array.isArray(body.data));

    if (!body || !validStatuses.has(status) || !hasSource || !hasDataWhenRequired) {
      console.error('[CONTRACT VIOLATION]', {
        route: req.originalUrl,
        body,
      });
    }

    return originalJson.call(this, body);
  };

  next();
}

module.exports = {
  contractGuard,
};