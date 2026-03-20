import { apiFetch as request } from '../api/apiClient';

export async function apiFetch(url) {
  try {
    return await request(url, { fallback: { ok: false } });
  } catch (_err) {
    console.error('API failure:', url);
    return { ok: false };
  }
}
