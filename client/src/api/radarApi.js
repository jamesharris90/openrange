import { apiFetch } from './apiClient';

async function fetchJson(path) {
  return apiFetch(path, { fallback: {} });
}

export async function fetchRadar() {
  return fetchJson('/api/radar/today');
}

export async function fetchRadarTopTrades() {
  return fetchJson('/api/radar/top-trades');
}
