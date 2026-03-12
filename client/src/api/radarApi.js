export async function fetchRadar() {
  const res = await fetch('/api/radar/today');
  if (!res.ok) throw new Error('Radar API failed');
  return res.json();
}
