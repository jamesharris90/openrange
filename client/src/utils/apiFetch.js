import { fetchSafe } from '../api/fetchSafe';

export async function apiFetch(url) {
  try {
    return await fetchSafe(url, { fallback: { ok: false } });
  } catch (_err) {
    console.error('API failure:', url);
    return { ok: false };
  }
}
