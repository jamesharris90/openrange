import { fetchSafe } from './fetchSafe';

async function fetchJson(path) {
  return fetchSafe(path, { fallback: {} });
}

export async function fetchWatchdog() {
  return fetchJson('/api/system/watchdog');
}
