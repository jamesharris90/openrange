/**
 * Authenticated fetch wrapper.
 * Automatically attaches JWT Bearer token from localStorage.
 *
 * In local development you can point at a remote backend by setting:
 *   VITE_API_BASE_URL=https://openrange-backend-production.up.railway.app
 * in client/.env.local. Leave unset (or empty) to use the Vite proxy / same origin.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export function authFetch(url, options = {}) {
  const token = localStorage.getItem('authToken');
  const headers = { ...options.headers };
  const resolvedUrl = `${API_BASE}${url}`;

  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Only set Content-Type for JSON bodies (not FormData, etc.)
  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  return fetch(resolvedUrl, { ...options, headers });
}
