import { apiFetch } from '../api/apiClient';

export async function radarFetch(path) {
  return apiFetch(path, { fallback: {} });
}

export function isLast24Hours(value) {
  if (!value) return false;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= 24 * 60 * 60 * 1000;
}
