function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function runSignalConfirmationEngine(row = {}) {
  const price = toNumber(row.price);
  const vwap = toNumber(row.vwap);
  const sectorStrength = toNumber(row.sector_strength);
  const relativeVolume = toNumber(row.relative_volume);

  const priceAboveVwap = price > 0 && vwap > 0 && price > vwap;
  const sectorPositive = sectorStrength > 0;
  const rvolRising = relativeVolume >= 1.5;

  const confirmationScore = (priceAboveVwap ? 4 : 0)
    + (sectorPositive ? 4 : 0)
    + (rvolRising ? 4 : 0);

  return {
    confirmation_score: confirmationScore,
    checks: {
      price_above_vwap: priceAboveVwap,
      sector_strength_positive: sectorPositive,
      relative_volume_rising: rvolRising,
    },
  };
}

module.exports = {
  runSignalConfirmationEngine,
};
