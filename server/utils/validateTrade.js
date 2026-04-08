function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function validateTrade(trade) {
  const errors = [];

  if (!trade || typeof trade !== 'object') {
    return { valid: false, errors: ['trade must be an object'] };
  }

  if (!isNonEmptyString(trade.symbol)) errors.push('symbol missing');
  if (!isNonEmptyString(trade.strategy)) errors.push('strategy missing');
  if (!isNonEmptyString(trade.why_moving)) errors.push('why_moving missing');
  if (!isNonEmptyString(trade.how_to_trade)) errors.push('how_to_trade missing');

  if (!isFiniteNumber(trade.confidence)) errors.push('confidence missing');
  if (!isFiniteNumber(trade.expected_move_percent)) errors.push('expected_move_percent missing');

  const plan = trade.execution_plan;
  if (!plan || typeof plan !== 'object') {
    errors.push('execution_plan missing');
  } else {
    if (!isNonEmptyString(plan.entry)) errors.push('execution_plan.entry missing');
    if (!isNonEmptyString(plan.stop)) errors.push('execution_plan.stop missing');
    if (!isNonEmptyString(plan.target)) errors.push('execution_plan.target missing');
  }

  if (!isNonEmptyString(trade.trade_class)) errors.push('trade_class missing');
  if (!isNonEmptyString(trade.updated_at)) errors.push('updated_at missing');

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateTrade,
};
