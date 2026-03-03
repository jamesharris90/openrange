const BaseBroker = require('./baseBroker');

class SaxoAdapter extends BaseBroker {
  constructor() {
    super('saxo');
  }

  normalise(raw) {
    return {
      symbol: raw.symbol || raw.AssetType || raw.Uic,
      side: (raw.side || raw.BuySell || '').toLowerCase() === 'buy' ? 'buy' : 'sell',
      qty: Math.abs(Number(raw.qty || raw.Amount || 0)),
      price: Number(raw.price || raw.Price || 0),
      commission: Math.abs(Number(raw.commission || raw.ExternalFee || 0)),
      execTime: raw.execTime || raw.ExecutionTime || new Date().toISOString(),
      broker: 'saxo',
      rawJson: raw,
    };
  }

  async fetchExecutions(connection, dateRange) {
    // Stub: Saxo OpenAPI integration not yet implemented
    return [];
  }
}

module.exports = new SaxoAdapter();
