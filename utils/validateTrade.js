function validateTrade(trade) {
  if (!trade || typeof trade !== 'object') {
    return { valid: false, errors: ['trade must be object'] };
  }

  const checks = [
    ['symbol', typeof trade.symbol === 'string' && trade.symbol.trim().length > 0],
    ['why_moving', typeof trade.why_moving === 'string' && trade.why_moving.trim().length > 0],
    ['how_to_trade', typeof trade.how_to_trade === 'string' && trade.how_to_trade.trim().length > 0],
    ['confidence', Number.isFinite(Number(trade.confidence))],
  ];

  const errors = checks.filter(([, ok]) => !ok).map(([field]) => `${field} missing`);
  return { valid: errors.length === 0, errors };
}

module.exports = { validateTrade };
