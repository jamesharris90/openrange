const pLimitModule = require('p-limit');
const pLimit = pLimitModule.default || pLimitModule;

const limit = pLimit(3);

module.exports = function safeProviderCall(fn) {
  return limit(() => fn());
};
