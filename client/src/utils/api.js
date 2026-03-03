/**
 * Authenticated fetch wrapper.
 * Automatically attaches JWT Bearer token from localStorage.
 */
export function authFetch(url, options = {}) {
  const token = localStorage.getItem('authToken');
  const headers = { ...options.headers };

  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Only set Content-Type for JSON bodies (not FormData, etc.)
  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  return fetch(url, { ...options, headers });
}
