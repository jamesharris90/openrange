// Utilities for ScreenerV2 numeric calculations, formatting, and sorting.

export function calcChangePercent(price, prevClose) {
  const p = Number(price);
  const prev = Number(prevClose);
  if (!Number.isFinite(p) || !Number.isFinite(prev) || prev === 0) return 0;
  return ((p - prev) / prev) * 100;
}

export function calcRelativeVolume(volume, avgVolume) {
  const v = Number(volume);
  const avg = Number(avgVolume);
  if (!Number.isFinite(v) || !Number.isFinite(avg) || avg === 0) return 0;
  return v / avg;
}

export function formatLargeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

export function sortRows(rows, key, direction) {
  const dir = direction === 'asc' ? 1 : -1;
  const data = [...rows];
  data.sort((a, b) => {
    const av = Number(a[key]);
    const bv = Number(b[key]);
    const aOk = Number.isFinite(av);
    const bOk = Number.isFinite(bv);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
    return dir * (av - bv);
  });
  return data;
}
