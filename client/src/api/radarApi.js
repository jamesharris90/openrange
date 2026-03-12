async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('Radar API failed');
  return res.json();
}

export async function fetchRadar() {
  return fetchJson('/api/radar/today');
}

export async function fetchRadarTopTrades() {
  return fetchJson('/api/radar/top-trades');
}
