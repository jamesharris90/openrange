import type { EarningsRow } from "@/lib/types";

import { cachedFetch } from "@/lib/cache";
import { debugLog } from "@/lib/debug";

type EarningsResponse = {
  data?: EarningsRow[];
};

function dateKey(value: unknown): string {
  return String(value || "").slice(0, 10);
}

export async function fetchEarnings(): Promise<EarningsRow[]> {
  return cachedFetch("earnings:all", async () => {
    const res = await fetch("/api/earnings", { cache: "no-store" });
    const json = (await res.json()) as EarningsResponse;
    const rows = Array.isArray(json.data) ? json.data : [];
    debugLog("fetchEarnings", { count: rows.length });
    return rows;
  });
}

export async function getEarnings(from: string, to: string): Promise<EarningsRow[]> {
  const rows = await fetchEarnings();
  if (!from || !to) return rows;

  return rows.filter((row) => {
    const rowDate = dateKey((row as unknown as { date?: unknown }).date || row.earnings_date);
    return rowDate >= from && rowDate <= to;
  });
}

export async function getEarningsCalendar(): Promise<EarningsRow[]> {
  const today = new Date();
  const to = new Date(today);
  to.setDate(to.getDate() + 7);

  const fromKey = today.toISOString().slice(0, 10);
  const toKey = to.toISOString().slice(0, 10);

  return getEarnings(fromKey, toKey);
}

export async function getTickerEarnings(ticker: string): Promise<EarningsRow[]> {
  const symbol = String(ticker || "").toUpperCase();
  const rows = await fetchEarnings();
  return rows.filter((row) => String(row.symbol || "").toUpperCase() === symbol).slice(0, 12);
}
