import { apiFetch } from './apiClient';

async function fetchJson(path) {
  return apiFetch(path, { fallback: {} });
}

export async function fetchCalibrationPerformance() {
  return fetchJson('/api/calibration/performance');
}