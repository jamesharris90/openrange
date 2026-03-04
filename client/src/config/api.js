const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }

  return res;
}

export async function apiJSON(path, options = {}) {
  const res = await apiFetch(path, options);
  return res.json();
}

export default API_BASE;