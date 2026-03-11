export async function apiFetch(url) {
  try {
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error('API error');
    }

    return await res.json();
  } catch (_err) {
    console.error('API failure:', url);
    return { ok: false };
  }
}
