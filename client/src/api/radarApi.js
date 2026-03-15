import { fetchSafe } from './fetchSafe';

async function fetchJson(path) {
  return fetchSafe(path, { fallback: {} });
}

export async function fetchRadar() {
  return fetchJson('/api/radar/today');
}

export async function fetchRadarTopTrades() {
  return fetchJson('/api/radar/top-trades');
}
