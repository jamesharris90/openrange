async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Calibration API failed: ${path}`);
  return res.json();
}

export async function fetchCalibrationPerformance() {
  return fetchJson('/api/calibration/performance');
}