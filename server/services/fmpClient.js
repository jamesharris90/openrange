const axios = require('axios');
const { info, warn, error } = require('../utils/logger');

const FMP_API_KEY = process.env.FMP_API_KEY;
const BASE_URL = 'https://financialmodelingprep.com/stable';
const REQUEST_SPACING_MS = 250;
const MAX_RETRIES = 3;

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  validateStatus: () => true,
});

let nextAllowedAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitGate() {
  const now = Date.now();
  if (now < nextAllowedAt) {
    await sleep(nextAllowedAt - now);
  }
  nextAllowedAt = Date.now() + REQUEST_SPACING_MS;
}

async function fmpFetch(endpoint, params = {}) {
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY is not configured');
  }

  const requestParams = {
    ...params,
    apikey: FMP_API_KEY,
  };

  let attempt = 0;
  let lastError = null;

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    const startedAt = Date.now();

    try {
      await rateLimitGate();
      const response = await client.get(endpoint, { params: requestParams });

      if (response.status >= 200 && response.status < 300) {
        info('FMP request ok', {
          endpoint,
          attempt,
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
        return response.data;
      }

      const statusError = new Error(`FMP ${endpoint} failed with status ${response.status}`);
      statusError.status = response.status;
      statusError.payload = response.data;
      lastError = statusError;

      warn('FMP request non-2xx', {
        endpoint,
        attempt,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      lastError = err;
      warn('FMP request exception', {
        endpoint,
        attempt,
        error: err.message,
        durationMs: Date.now() - startedAt,
      });
    }

    if (attempt < MAX_RETRIES) {
      const backoffMs = 300 * 2 ** (attempt - 1);
      await sleep(backoffMs);
    }
  }

  error('FMP request failed after retries', {
    endpoint,
    retries: MAX_RETRIES,
    error: lastError?.message,
  });

  throw lastError || new Error(`FMP request failed: ${endpoint}`);
}

module.exports = {
  fmpFetch,
};
