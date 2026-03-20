export function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isNaN(num) ? fallback : num;
}

export function toFixedSafe(value: unknown, digits = 2): string {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return "—";
  return num.toFixed(digits);
}

export function percentSafe(value: unknown, digits = 2): string {
  const fixed = toFixedSafe(value, digits);
  return fixed === "—" ? "—" : `${fixed}%`;
}
