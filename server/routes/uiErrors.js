const uiErrors = [];

function uiError(req, res) {
  const payload = {
    at: new Date().toISOString(),
    ...(req.body || {}),
  };
  uiErrors.unshift(payload);
  if (uiErrors.length > 200) uiErrors.length = 200;
  global.uiErrorCount = uiErrors.length;
  console.error('UI ERROR:', payload);
  res.json({ ok: true, data: null, error: null });
}

function uiErrorLog(req, res) {
  res.json({ ok: true, data: uiErrors.slice(0, 50), error: null });
}

module.exports = {
  uiError,
  uiErrorLog,
};
