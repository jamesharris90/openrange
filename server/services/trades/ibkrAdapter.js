const BaseBroker = require('./baseBroker');

class IbkrAdapter extends BaseBroker {
  constructor() {
    super('ibkr');
  }

  normalise(raw) {
    return {
      symbol: raw.symbol || raw.conid || raw.ticker,
      side: (raw.side || raw.action || '').toLowerCase() === 'buy' ? 'buy' : 'sell',
      qty: Math.abs(Number(raw.qty || raw.shares || raw.quantity || 0)),
      price: Number(raw.price || raw.avgPrice || 0),
      commission: Math.abs(Number(raw.commission || raw.fees || 0)),
      execTime: raw.execTime || raw.time || raw.dateTime || new Date().toISOString(),
      broker: 'ibkr',
      rawJson: raw,
    };
  }

  async fetchExecutions(connection, dateRange) {
    // Stubbed: in production this would call the IBKR Client Portal API
    // GET /iserver/account/{accountId}/orders with date filters
    // For now returns empty — demo data comes from demoSeeder
    return [];
  }
}

module.exports = new IbkrAdapter();
