// Performance analytics foundation helpers
// Each function expects sanitized, numeric inputs.

function calculateWinRate(trades = []) {
  if (!Array.isArray(trades) || trades.length === 0) return 0;
  const wins = trades.filter(t => (t.pnl || 0) > 0).length;
  return +(wins / trades.length * 100).toFixed(2);
}

function calculateExpectancy(trades = []) {
  if (!Array.isArray(trades) || trades.length === 0) return 0;
  const wins = trades.filter(t => (t.pnl || 0) > 0);
  const losses = trades.filter(t => (t.pnl || 0) < 0);
  const avgWin = wins.length ? wins.reduce((sum, t) => sum + (t.pnl || 0), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((sum, t) => sum + (t.pnl || 0), 0) / losses.length : 0;
  const winRate = calculateWinRate(trades) / 100;
  const lossRate = 1 - winRate;
  return +(winRate * avgWin + lossRate * avgLoss).toFixed(2);
}

function calculateMaxDrawdown(equityCurve = []) {
  if (!Array.isArray(equityCurve) || equityCurve.length === 0) return 0;
  let peak = -Infinity;
  let maxDd = 0;
  for (const point of equityCurve) {
    const equity = typeof point === 'number' ? point : point.equity;
    if (equity == null) continue;
    peak = Math.max(peak, equity);
    const dd = peak ? (peak - equity) / peak : 0;
    maxDd = Math.max(maxDd, dd);
  }
  return +(maxDd * 100).toFixed(2);
}

function calculateAverageWinLoss(trades = []) {
  if (!Array.isArray(trades) || trades.length === 0) return { avgWin: 0, avgLoss: 0 };
  const wins = trades.filter(t => (t.pnl || 0) > 0);
  const losses = trades.filter(t => (t.pnl || 0) < 0);
  const avgWin = wins.length ? wins.reduce((sum, t) => sum + (t.pnl || 0), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((sum, t) => sum + (t.pnl || 0), 0) / losses.length : 0;
  return { avgWin: +avgWin.toFixed(2), avgLoss: +avgLoss.toFixed(2) };
}

module.exports = {
  calculateWinRate,
  calculateExpectancy,
  calculateMaxDrawdown,
  calculateAverageWinLoss
};
