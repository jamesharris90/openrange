const { info, warn, error } = require('../utils/logger');

function toArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.results)) return payload.results;
  return null;
}

async function singleRequest(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: controller.signal });
    const raw = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch (_err) {
      payload = null;
    }
    return {
      http_status: response.status,
      payload,
      duration_ms: Date.now() - started,
      transport_error: null,
    };
  } catch (err) {
    return {
      http_status: 0,
      payload: null,
      duration_ms: Date.now() - started,
      transport_error: err?.name === 'AbortError' ? 'timeout' : (err.message || 'request_error'),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fmpRequest({ endpointKey, endpointUrl, query = {}, timeoutMs = 3000, retryAttempts = 1 }) {
  const key = process.env.FMP_API_KEY;
  if (!key) {
    return {
      success: false,
      endpoint_key: endpointKey,
      http_status: 0,
      data: [],
      count: 0,
      error: 'FMP_API_KEY missing',
      is_empty: true,
      duration_ms: 0,
    };
  }

  const url = new URL(endpointUrl);
  for (const [k, v] of Object.entries(query || {})) {
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set('apikey', key);

  const attempts = Math.max(1, 1 + Number(retryAttempts || 0));
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await singleRequest(url.toString(), timeoutMs);
    const data = toArray(last.payload);
    const validArray = Array.isArray(data);
    const isEmpty = validArray ? data.length === 0 : true;
    const success = last.http_status === 200 && validArray;

    const result = {
      success,
      endpoint_key: endpointKey,
      http_status: last.http_status,
      data: validArray ? data : [],
      count: validArray ? data.length : 0,
      error: null,
      is_empty: isEmpty,
      duration_ms: last.duration_ms,
    };

    if (last.transport_error) {
      result.error = last.transport_error;
    } else if (last.http_status !== 200) {
      result.error = `http_${last.http_status}`;
    } else if (!validArray) {
      result.error = 'data_not_array';
    } else if (isEmpty) {
      result.error = 'empty_array';
    }

    if (result.success) {
      info('FMP structured request success', {
        endpoint_key: endpointKey,
        endpoint_url: endpointUrl,
        http_status: result.http_status,
        count: result.count,
        attempt,
        duration_ms: result.duration_ms,
      });
      return result;
    }

    warn('FMP structured request failed', {
      endpoint_key: endpointKey,
      endpoint_url: endpointUrl,
      http_status: result.http_status,
      error: result.error,
      count: result.count,
      attempt,
      duration_ms: result.duration_ms,
    });

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const fallback = {
    success: false,
    endpoint_key: endpointKey,
    http_status: last?.http_status || 0,
    data: [],
    count: 0,
    error: last?.transport_error || (last?.http_status ? `http_${last.http_status}` : 'request_failed'),
    is_empty: true,
    duration_ms: last?.duration_ms || 0,
  };
  error('FMP structured request exhausted retries', {
    endpoint_key: endpointKey,
    endpoint_url: endpointUrl,
    http_status: fallback.http_status,
    error: fallback.error,
    duration_ms: fallback.duration_ms,
  });
  return fallback;
}

module.exports = {
  fmpRequest,
};
