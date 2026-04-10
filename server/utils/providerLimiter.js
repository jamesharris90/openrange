const createConcurrencyLimiter = require('./createConcurrencyLimiter');

const limit = createConcurrencyLimiter(2);

module.exports = function limitProvider(fn) {
  return limit(() => fn());
};
