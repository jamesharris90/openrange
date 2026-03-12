async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Request failed: ${path}`);
  return res.json();
}

export async function fetchWatchdog() {
  return fetchJson('/api/system/watchdog');
}
