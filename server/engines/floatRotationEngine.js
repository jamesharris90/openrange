function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function runFloatRotationEngine(row = {}) {
  const volume = toNumber(row.volume);
  const floatShares = toNumber(row.float_shares);
  const floatRotation = floatShares > 0 ? (volume / floatShares) : 0;
  const scoreContribution = floatRotation > 2 ? Math.min(15, floatRotation * 6) : Math.min(8, floatRotation * 4);

  return {
    float_rotation: floatRotation,
    score_contribution: scoreContribution,
  };
}

module.exports = {
  runFloatRotationEngine,
};
