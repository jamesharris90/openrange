import { logApiCall } from '../utils/apiDiagnostics';

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export async function apiFetch(path, options = {}) {
  logApiCall(path);

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await res.text();
  const trimmed = text.trim();

  if (trimmed.startsWith('<!DOCTYPE html')) {
    console.error('Frontend API misrouting detected', {
      path,
      preview: trimmed.slice(0, 200),
    });
    throw new Error('Invalid JSON response');
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    console.error('API returned non-JSON:', trimmed.slice(0, 200));
    throw new Error('Invalid JSON response');
  }

  if (!res.ok) {
    const message = typeof payload?.detail === 'string'
      ? payload.detail
      : JSON.stringify(payload);
    throw new Error(`API ${res.status}: ${message}`);
  }

  return payload;
}

export async function apiJSON(path, options = {}) {
  return apiFetch(path, options);
}

export default API_BASE;