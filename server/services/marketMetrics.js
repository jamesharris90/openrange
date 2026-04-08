function calculateExpectedMove({ atr, price }) {
  if (!atr || !price) return null;

  return {
    value: atr,
    percent: (atr / price) * 100,
  };
}

module.exports = {
  calculateExpectedMove,
};