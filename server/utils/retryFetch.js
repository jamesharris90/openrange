async function retryFetch(fn, retries = 3) {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;

    console.log('[RETRY]', retries);

    await new Promise((r) => setTimeout(r, 1000));

    return retryFetch(fn, retries - 1);
  }
}

module.exports = retryFetch;
