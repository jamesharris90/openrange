const axios = require('axios');

async function providerRequest(url, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 3;
  const timeout = Number.isFinite(options.timeout) ? options.timeout : 10000;
  const rawResponse = Boolean(options.rawResponse);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await axios.get(url, {
        timeout,
        validateStatus: options.validateStatus,
        headers: options.headers,
      });
      return rawResponse ? res : res.data;
    } catch (err) {
      const status = err?.response?.status;
      const isTimeout = err?.code === 'ETIMEDOUT' || err?.code === 'ECONNABORTED';
      if (status === 429 || isTimeout) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw new Error('Provider failed after retries');
}

module.exports = {
  providerRequest,
};
