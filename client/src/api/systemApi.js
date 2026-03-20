import { apiFetch } from './apiClient';

async function fetchJson(path) {
  return apiFetch(path, { fallback: {} });
}

export async function fetchWatchdog() {
  return fetchJson('/api/system/watchdog');
}
