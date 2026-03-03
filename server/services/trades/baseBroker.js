class BaseBroker {
  constructor(brokerName) {
    this.brokerName = brokerName;
  }

  normalise(rawExecution) {
    throw new Error(`${this.brokerName}: normalise() not implemented`);
  }

  async fetchExecutions(connection, dateRange) {
    throw new Error(`${this.brokerName}: fetchExecutions() not implemented`);
  }

  validate(normalised) {
    const required = ['symbol', 'side', 'qty', 'price', 'execTime'];
    for (const field of required) {
      if (normalised[field] == null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    if (!['buy', 'sell'].includes(normalised.side)) {
      throw new Error(`Invalid side: ${normalised.side}`);
    }
    if (normalised.qty <= 0) {
      throw new Error(`Invalid qty: ${normalised.qty}`);
    }
    if (normalised.price <= 0) {
      throw new Error(`Invalid price: ${normalised.price}`);
    }
    return true;
  }
}

module.exports = BaseBroker;
