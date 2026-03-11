const pLimit = require('p-limit');

const limit = pLimit(2);

module.exports = function limitProvider(fn) {
  return limit(() => fn());
};
