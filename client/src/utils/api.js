import { fetchSafeRaw } from '../api/fetchSafe';
import BASE_URL, { normalizeApiPath } from '../api/apiClient';

export function authFetch(url, options = {}) {
  const token = localStorage.getItem('openrange_token') || localStorage.getItem('authToken');
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const resolvedUrl = `${BASE_URL}${normalizeApiPath(url)}`;
  console.log('[API CALL]', resolvedUrl);

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
