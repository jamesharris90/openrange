module.exports = function createConcurrencyLimiter(concurrency) {
  const maxConcurrency = Math.max(1, Number(concurrency) || 1);
  let activeCount = 0;
  const queue = [];

  const runNext = () => {
    if (activeCount >= maxConcurrency || queue.length === 0) {
      return;
    }

    const { fn, resolve, reject } = queue.shift();
    activeCount += 1;

    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        activeCount -= 1;
        runNext();
      });
  };

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      runNext();
    });
  };
};