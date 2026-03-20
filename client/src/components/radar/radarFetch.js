import { get } from '../../api/apiClient';

const RADAR_TIMEOUT_MS = 500;
const MAX_IN_FLIGHT = 5;

let inFlight = 0;
const waitQueue = [];

function acquireSlot() {
  return new Promise((resolve) => {
    if (inFlight < MAX_IN_FLIGHT) {
      inFlight += 1;
      resolve();
      return;
    }
    waitQueue.push(resolve);
  });
}

function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1);
  const next = waitQueue.shift();
  if (next) {
    inFlight += 1;
    next();
  }
}

function authHeaders() {
  const token = localStorage.getItem('openrange_token') || localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function withTimeoutSignal(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs);

  const onAbort = () => controller.abort(new Error('Request aborted'));
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(new Error('Request aborted'));
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    },
  };
}

export async function radarFetchJson(endpoint, { timeoutMs = RADAR_TIMEOUT_MS, signal } = {}) {
  await acquireSlot();

  const { signal: composedSignal, cleanup } = withTimeoutSignal(timeoutMs, signal);

  try {
    return await get(endpoint, {
      headers: {
        Accept: 'application/json',
        ...authHeaders(),
      },
      signal: composedSignal,
      fallback: {},
      returnFallbackOnError: false,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  } finally {
    cleanup();
    releaseSlot();
  }
}

export function isLast24Hours(value) {
  if (!value) return false;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= 24 * 60 * 60 * 1000;
}
