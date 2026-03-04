const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export function apiFetch(path, options = {}) {
  return fetch(`${API_BASE}${path}`, options);
}

export default API_BASE;