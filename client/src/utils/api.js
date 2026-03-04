const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export function authFetch(url, options = {}) {
  const token = localStorage.getItem('authToken');
  const headers = { ...options.headers };

  const resolvedUrl = `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`;

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  return fetch(resolvedUrl, {
    ...options,
    headers,
    credentials: 'include'
  });
}
