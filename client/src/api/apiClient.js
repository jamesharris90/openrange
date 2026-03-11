const API_BASE =
  import.meta.env.VITE_API_URL ||
  'https://openrange-backend-production.up.railway.app';

function normalizeApiPath(path) {
  const raw = String(path || '').trim();
  if (!raw) return '/api';
  if (raw.startsWith('/api')) return raw;
  if (raw.startsWith('/')) return `/api${raw}`;
  return `/api/${raw}`;
}

export async function safeFetch(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error('Non JSON response');
  }

  return response.json();
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

export default API_BASE;
