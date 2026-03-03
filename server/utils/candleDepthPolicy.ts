// @ts-nocheck

function applyDepthPolicy(data, timeframe) {
  const limits = {
    '1min': 2000,
    '3min': 1500,
    '5min': 1200,
    '15min': 1000,
    '1hour': 1500,
    '4hour': 1500,
    '1day': 1250,
    '1week': 1000,
  };

  const safe = Array.isArray(data) ? data : [];
  const limit = limits[timeframe];
  if (!limit) return safe;
  return safe.length > limit ? safe.slice(-limit) : safe;
}

module.exports = {
  applyDepthPolicy,
};
