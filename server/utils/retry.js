const wait = (ms) => new Promise(res => setTimeout(res, ms));

async function withRetry(fn, opts = {}) {
  const {
    retries = 3,
    baseDelay = 200,
    factor = 2,
    onError,
    shouldRetry,
  } = opts;

  let attempt = 0;
  let delay = baseDelay;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const retryable = shouldRetry ? shouldRetry(err, attempt) : isRetryable(err);
      if (attempt >= retries || !retryable) throw err;
      onError?.(err, attempt + 1);
      await wait(delay + Math.random() * 50);
      delay *= factor;
      attempt += 1;
    }
  }
}

function isRetryable(err) {
  const status = err?.response?.status;
  if (status === 429 || (status && status >= 500)) return true;
  return false;
}

module.exports = { withRetry };
