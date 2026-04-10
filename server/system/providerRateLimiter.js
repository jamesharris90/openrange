const createConcurrencyLimiter = require('../utils/createConcurrencyLimiter');

const limit = createConcurrencyLimiter(3);

module.exports = function safeProviderCall(fn) {
  return limit(() => fn());
};
