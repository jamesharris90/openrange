function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getMarketRegime({ spy, qqq, vix }) {
  const spyChange = toNumber(spy);
  const qqqChange = toNumber(qqq);
  const vixLevel = toNumber(vix);

  if (vixLevel !== null && vixLevel > 22) return "RISK_OFF";
  if ((spyChange || 0) > 0 && (qqqChange || 0) > 0) return "TRENDING_UP";
  if ((spyChange || 0) < 0 && (qqqChange || 0) < 0) return "TRENDING_DOWN";
  return "MIXED";
}

module.exports = {
  getMarketRegime,
};