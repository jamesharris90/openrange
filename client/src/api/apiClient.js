import { apiFetch as strictApiFetch, API_BASE } from '../lib/apiClient';

function normalizeApiPath(path) {
  const raw = String(path || '').trim();
  if (!raw) return '/api';
  if (raw.startsWith('/api')) return raw;
  if (raw.startsWith('/')) return `/api${raw}`;
  return `/api/${raw}`;
}

function buildUrl(path) {
  const url = `${API_BASE}${normalizeApiPath(path)}`;
  console.log('[API CALL]', url);
  return url;
}

function normalizeResponse(res) {
  if (!res) return { success: false, data: [] };

  const data = res.data || res.rows || res.result || [];

  return {
    success: true,
    data: Array.isArray(data) ? data : [],
  };
}

function withAuthHeaders(options = {}) {
  const token = localStorage.getItem('openrange_token') || localStorage.getItem('authToken');

  return {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  };
}

export async function safeFetch(path, options = {}) {
  const json = await strictApiFetch(normalizeApiPath(path), withAuthHeaders(options));
  return normalizeResponse(json);
}

export async function apiFetch(path, options = {}) {
  return safeFetch(path, options);
}

export async function apiJSON(path, options = {}) {
  return apiFetch(path, options);
}

export async function apiClient(path, options = {}) {
  const response = await apiFetch(path, options);
  return response.data;
}

export async function get(path, options = {}) {
  return apiFetch(path, { ...options, method: 'GET' });
}

export async function post(path, body, options = {}) {
  return apiFetch(path, {
    ...options,
    method: 'POST',
    body: body == null || typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function put(path, body, options = {}) {
  return apiFetch(path, {
    ...options,
    method: 'PUT',
    body: body == null || typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function patch(path, body, options = {}) {
  return apiFetch(path, {
    ...options,
    method: 'PATCH',
    body: body == null || typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function del(path, options = {}) {
  return apiFetch(path, { ...options, method: 'DELETE' });
}

const BASE_URL = API_BASE;

export { BASE_URL };
export { normalizeApiPath, buildUrl, normalizeResponse };
export default BASE_URL;
