export const STALE_WINDOW_MINUTES = 15;

export type Tradeability = "TRADEABLE" | "STALE" | "INVALID";

export type TradeabilityResult = {
  status: Tradeability;
  reasons: string[];
};

export function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function isFreshTimestamp(value: unknown, windowMinutes = STALE_WINDOW_MINUTES): boolean {
  if (!value) return false;
  const ts = Date.parse(String(value));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= windowMinutes * 60 * 1000;
}

export function tradeabilityCheck(input: {
  timestamp?: unknown;
  changePercent?: unknown;
  volume?: unknown;
  relativeVolume?: unknown;
  catalyst?: unknown;
}): TradeabilityResult {
  const reasons: string[] = [];

  if (!isFreshTimestamp(input.timestamp)) {
    reasons.push("stale_timestamp");
  }

  const change = Math.abs(toNum(input.changePercent));
  if (change <= 0) {
    reasons.push("no_recent_price_movement");
  }

  const volume = toNum(input.volume);
  const rvol = toNum(input.relativeVolume);
  if (volume <= 0 && rvol <= 0) {
    reasons.push("no_volume");
  }

  const catalyst = String(input.catalyst || "").trim();
  if (!catalyst) {
    reasons.push("no_catalyst");
  }

  if (reasons.length === 0) {
    return { status: "TRADEABLE", reasons };
  }

  if (reasons.includes("stale_timestamp")) {
    return { status: "STALE", reasons };
  }

  return { status: "INVALID", reasons };
}

export function enforceUiDbAlignment(page: string, uiCount: number, dbCount: number): { pass: boolean; message: string } {
  const pass = uiCount === dbCount;
  const message = pass
    ? `[ALIGNMENT PASS] ${page}: ui=${uiCount}, db=${dbCount}`
    : `[ALIGNMENT FAIL] ${page}: ui=${uiCount}, db=${dbCount}`;

  if (!pass) {
    console.error(message);
  } else {
    console.log(message);
  }

  return { pass, message };
}

export function bucketBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, T[]> {
  return rows.reduce<Record<string, T[]>>((acc, row) => {
    const key = keyFn(row) || "UNKNOWN";
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
}
