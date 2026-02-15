// IBKR provider (read-only, monitoring-only). Real API calls are stubbed for now.

async function login({ username, password }) {
  if (!username || !password) {
    throw new Error('Username and password required');
  }
  // Stub: in production exchange credentials for session tokens
  return {
    accessToken: `ibkr-${Buffer.from(username).toString('hex').slice(0, 12)}`,
    refreshToken: null
  };
}

async function getAccountSummary() {
  return {
    netLiquidation: 125000.45,
    buyingPower: 250000.00,
    cash: 42000.12,
    marginUsedPercent: 36.4,
    unrealizedPnL: 2350.78,
    realizedPnL: 1180.25
  };
}

async function getPositions() {
  return [
    {
      symbol: 'AAPL',
      side: 'long',
      quantity: 250,
      avgEntry: 182.40,
      currentPrice: 189.75,
      marketValue: 47437.50,
      unrealizedDollar: 1837.50,
      unrealizedPercent: 4.03,
      accountWeightPercent: 37.9,
      dayChangeDollar: 312.50
    },
    {
      symbol: 'MSFT',
      side: 'long',
      quantity: 120,
      avgEntry: 394.10,
      currentPrice: 401.30,
      marketValue: 48156.00,
      unrealizedDollar: 864.00,
      unrealizedPercent: 1.82,
      accountWeightPercent: 38.5,
      dayChangeDollar: 216.00
    },
    {
      symbol: 'QQQ',
      side: 'short',
      quantity: 50,
      avgEntry: 425.00,
      currentPrice: 423.10,
      marketValue: -21155.00,
      unrealizedDollar: 95.00,
      unrealizedPercent: 0.45,
      accountWeightPercent: -16.9,
      dayChangeDollar: -45.00
    }
  ];
}

async function getDailyPnL() {
  return {
    date: new Date().toISOString().slice(0, 10),
    gross: 740.12,
    net: 695.44,
    fees: 44.68
  };
}

async function getHistoricalEquity(days = 7) {
  const points = [];
  const base = 120000;
  for (let i = days - 1; i >= 0; i -= 1) {
    const noise = Math.sin(i / 2) * 300 + (Math.random() - 0.5) * 200;
    points.push({
      date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
      equity: +(base + noise + (days - i) * 250).toFixed(2)
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
