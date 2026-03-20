export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

export function asString(value: unknown, fallback = ""): string {
  const normalized = String(value ?? fallback).trim();
  return normalized;
}

export function asNumber(value: unknown, fallback = Number.NaN): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function asNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function asTimestamp(value: unknown): number {
  const direct = asNumber(value);
  if (Number.isFinite(direct)) return direct;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function pickDataArray(payload: unknown): Record<string, unknown>[] {
  const root = asObject(payload);
  const direct = asArray(root.data);
  if (direct.length > 0) return direct;

  const dataObject = asObject(root.data);
  const nested = asArray(dataObject.data);
  if (nested.length > 0) return nested;

  return [];
}
