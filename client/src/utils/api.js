import { fetchSafeRaw } from '../api/fetchSafe';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export function authFetch(url, options = {}) {
  const token = localStorage.getItem('openrange_token') || localStorage.getItem('authToken');
  const headers = { ...options.headers };

  const resolvedUrl = `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`;

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  return fetchSafeRaw(resolvedUrl, {
    ...options,
    headers,
    credentials: 'include',
    returnFallbackOnError: false,
  });
}

export async function authFetchJSON(url, options = {}) {
  const json = await authFetch(url, options);
  return json && typeof json === 'object' ? json : {};
}
