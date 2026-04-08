function classifyTrade({
  truth_valid,
  execution_valid,
  trade_quality_score,
  setup_quality,
}) {
  if (!truth_valid || !execution_valid) {
    return 'UNTRADEABLE';
  }

  if (trade_quality_score >= 80 && setup_quality === 'HIGH') {
    return 'A';
  }

  if (trade_quality_score >= 65) {
    return 'B';
  }

  return 'C';
}

function calculatePositionSize({
  entry,
  stop,
  maxRisk = 10,
}) {
  if (!entry || !stop) return null;

  const riskPerShare = Math.abs(entry - stop);

  if (riskPerShare === 0) return null;

  const size = Math.floor(maxRisk / riskPerShare);

  return {
    position_size: size,
    risk_per_share: riskPerShare,
    max_risk: maxRisk,
  };
}

module.exports = {
  classifyTrade,
  calculatePositionSize,
};