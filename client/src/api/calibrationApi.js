import { fetchSafe } from './fetchSafe';

async function fetchJson(path) {
  return fetchSafe(path, { fallback: {} });
}

export async function fetchCalibrationPerformance() {
  return fetchJson('/api/calibration/performance');
}