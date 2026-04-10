const axios = require('axios');
const { info, warn, error } = require('../utils/logger');

const FMP_API_KEY = process.env.FMP_API_KEY;
const BASE_URL = 'https://financialmodelingprep.com/stable';
const REQUESTS_PER_SECOND = 4;
const REQUEST_SPACING_MS = Math.ceil(1000 / REQUESTS_PER_SECOND);
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const JITTER_MAX_MS = 400;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_THRESHOLD = 3;
const CIRCUIT_BREAKER_MS = 60 * 1000;

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  validateStatus: () => true,
});

let nextAllowedAt = 0;
let circuitOpenUntil = 0;
const rateLimitEvents = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitGate() {
  if (Date.now() < circuitOpenUntil) {
    const waitMs = circuitOpenUntil - Date.now();
    const error = new Error(`FMP circuit breaker open for ${waitMs}ms`);
    error.status = 429;
    throw error;
  }

  const now = Date.now();
  if (now < nextAllowedAt) {
    await sleep(nextAllowedAt - now);
  }
  nextAllowedAt = Date.now() + REQUEST_SPACING_MS;
}

function trimRateLimitEvents(now) {
  while (rateLimitEvents.length > 0 && now - rateLimitEvents[0] > RATE_LIMIT_WINDOW_MS) {
    rateLimitEvents.shift();
  }
}

function recordRateLimitHit() {
  const now = Date.now();
  rateLimitEvents.push(now);
  trimRateLimitEvents(now);

  if (rateLimitEvents.length >= RATE_LIMIT_THRESHOLD) {
    circuitOpenUntil = now + CIRCUIT_BREAKER_MS;
    warn('FMP circuit breaker opened', {
      threshold: RATE_LIMIT_THRESHOLD,
      windowMs: RATE_LIMIT_WINDOW_MS,
      pauseMs: CIRCUIT_BREAKER_MS,
    });
  }
}

function backoffWithJitter(attempt) {
  const exponential = BACKOFF_BASE_MS * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
  return exponential + jitter;
}

async function fmpFetch(endpoint, params = {}) {
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY is not configured');
  }

  if (/\/api\/v[34]\b/i.test(String(endpoint || ''))) {
    const legacyError = new Error(`Legacy FMP endpoint blocked: ${endpoint}`);
    legacyError.code = 'FMP_LEGACY_ENDPOINT_BLOCKED';
    warn('FMP legacy endpoint blocked', { endpoint });
    throw legacyError;
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

      if (response.status === 429) {
        recordRateLimitHit();
      }

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
      const status = Number(lastError?.status || 0);
      const backoffMs = backoffWithJitter(attempt);
      if (status === 429) {
        warn('FMP rate limited, backing off', {
          endpoint,
          attempt,
          status,
          waitMs: backoffMs,
        });
      }
      await sleep(backoffMs);
    }
  }

  if (Number(lastError?.status || 0) === 429) {
    error('FMP_RATE_LIMIT_EXCEEDED', {
      endpoint,
      retries: MAX_RETRIES,
      error: lastError?.message,
    });
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
