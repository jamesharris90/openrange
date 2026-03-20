const API_BASE = import.meta.env.VITE_API_URL;

if (!API_BASE) {
  throw new Error('VITE_API_URL is not defined');
}

if (import.meta.env.DEV && String(API_BASE).toLowerCase().includes('railway')) {
  throw new Error('DEV MODE USING PRODUCTION BACKEND');
}

console.log('[ENV]', import.meta.env.MODE);
console.log('[API BASE]', API_BASE);

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[API ERROR]', res.status, text);
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}

export { API_BASE };
export default API_BASE;