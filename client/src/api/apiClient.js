import { fetchSafe } from './fetchSafe';

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:3001';

function normalizeApiPath(path) {
  const raw = String(path || '').trim();
  if (!raw) return '/api';
  if (raw.startsWith('/api')) return raw;
  if (raw.startsWith('/')) return `/api${raw}`;
  return `/api/${raw}`;
}

export async function safeFetch(url, options = {}) {
  return fetchSafe(url, { ...options, fallback: {}, returnFallbackOnError: false });
}

export async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${normalizeApiPath(path)}`;
  const token = localStorage.getItem('openrange_token') || localStorage.getItem('authToken');

  return safeFetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
}

export async function apiJSON(path, options = {}) {
  return apiFetch(path, options);
}

export async function apiClient(path, options = {}) {
  const response = await apiFetch(path, options);
  if (response && Object.prototype.hasOwnProperty.call(response, 'ok') && Object.prototype.hasOwnProperty.call(response, 'data')) {
    return response.data;
  }
  return response;
}

export default API_BASE;
