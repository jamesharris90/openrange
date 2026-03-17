function contractGuard(req, res, next) {
  const originalJson = res.json;

  res.json = function jsonWithContractGuard(body) {
    if (!body || body.success === undefined || body.data === undefined) {
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