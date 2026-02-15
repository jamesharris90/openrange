// Legacy Saxo provider (monitoring-only, stubbed).

async function login({ username, password }) {
  if (!username || !password) {
    throw new Error('Username and password required');
  }
  return {
    accessToken: `saxo-${Buffer.from(username).toString('hex').slice(0, 12)}`,
    refreshToken: null
  };
}

async function getAccountSummary() {
  return {
    netLiquidation: 98000.15,
    buyingPower: 160000.00,
    cash: 28000.00,
    marginUsedPercent: 28.1,
    unrealizedPnL: 1240.10,
    realizedPnL: 640.55
  };
}

async function getPositions() {
  return [
    {
      symbol: 'SPY',
      side: 'long',
      quantity: 150,
      avgEntry: 497.20,
      currentPrice: 501.10,
      marketValue: 75165.00,
      unrealizedDollar: 585.00,
      unrealizedPercent: 0.78,
      accountWeightPercent: 76.7,
      dayChangeDollar: 225.00
    },
    {
      symbol: 'EURUSD',
      side: 'short',
      quantity: 50000,
      avgEntry: 1.0840,
      currentPrice: 1.0815,
      marketValue: -540.00,
      unrealizedDollar: 1250.00,
      unrealizedPercent: 1.15,
      accountWeightPercent: -12.0,
      dayChangeDollar: 90.00
    }
  ];
}

async function getDailyPnL() {
  return {
    date: new Date().toISOString().slice(0, 10),
    gross: 320.45,
    net: 310.10,
    fees: 10.35
  };
}

async function getHistoricalEquity(days = 7) {
  const points = [];
  const base = 95000;
  for (let i = days - 1; i >= 0; i -= 1) {
    const noise = Math.cos(i / 3) * 250 + (Math.random() - 0.5) * 150;
    points.push({
      date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
      equity: +(base + noise + (days - i) * 180).toFixed(2)
    });
  }
  return points;
}

module.exports = {
  login,
  getAccountSummary,
  getPositions,
  getDailyPnL,
  getHistoricalEquity
};
