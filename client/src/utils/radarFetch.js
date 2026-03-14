const API_BASE =
  import.meta.env.VITE_API_URL ||
  'https://openrange-backend-production.up.railway.app';

export async function radarFetch(path) {
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Radar API error: ${res.status}`);
  }

  return res.json();
}

export function isLast24Hours(value) {
  if (!value) return false;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= 24 * 60 * 60 * 1000;
}
