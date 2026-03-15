import { fetchSafe } from '../api/fetchSafe';

const API_BASE =
  import.meta.env.VITE_API_URL ||
  'https://openrange-backend-production.up.railway.app';

export async function radarFetch(path) {
  const url = `${API_BASE}${path}`;

  return fetchSafe(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    fallback: {},
  });
}

export function isLast24Hours(value) {
  if (!value) return false;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= 24 * 60 * 60 * 1000;
}
