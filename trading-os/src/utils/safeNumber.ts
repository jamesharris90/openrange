export function safeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function safeFixed(value: unknown, digits = 2, fallback = "0.00"): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed.toFixed(digits);
}

export function safePercent(value: unknown, digits = 2, fallback = "0.00%"): string {
  const fixed = safeFixed(value, digits, fallback.replace("%", ""));
  return `${fixed}%`;
}
