import type { EarningsRow } from "@/lib/types";

import { apiGet } from "@/lib/api/client";
import { debugLog } from "@/lib/debug";
import { validateEarningsPayload } from "@/lib/validators/contract-payload-validator";

type EarningsResponse = {
  data?: EarningsRow[];
};

function isoDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getCurrentTradingWeekWindow() {
  const now = new Date();
  const utcToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = utcToday.getUTCDay();

  const nextTradingDay = day === 6
    ? addUtcDays(utcToday, 2)
    : day === 0
      ? addUtcDays(utcToday, 1)
      : utcToday;

  const nextTradingDayDow = nextTradingDay.getUTCDay();
  const monday = addUtcDays(nextTradingDay, nextTradingDayDow === 0 ? -6 : -(nextTradingDayDow - 1));
  const friday = addUtcDays(monday, 4);

  return {
    from: isoDateUtc(monday),
    to: isoDateUtc(friday),
  };
}

export async function fetchEarnings(): Promise<EarningsRow[]> {
  const { from, to } = getCurrentTradingWeekWindow();
  const json = await apiGet<EarningsResponse | EarningsRow[]>(
    `/api/earnings/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { cache: "no-store" }
  );

  const rawRows = Array.isArray(json)
    ? json
    : (Array.isArray((json as EarningsResponse).data) ? (json as EarningsResponse).data || [] : []);

  const rows = rawRows.map((row) => {
    const mappedRow = {
      ...row,
      event_date: String((row as Record<string, unknown>).event_date || ""),
      tradeability: String((row as Record<string, unknown>).tradeability || ""),
      revenue_estimate: (row as Record<string, unknown>).revenue_estimate ?? (row as Record<string, unknown>).rev_estimate ?? null,
      revenue_actual: (row as Record<string, unknown>).revenue_actual ?? (row as Record<string, unknown>).rev_actual ?? null,
    };
    validateEarningsPayload(mappedRow as Record<string, unknown>);
    return mappedRow;
  }) as EarningsRow[];

  debugLog("fetchEarnings", { count: rows.length, from, to });
  return rows;
}

export async function getEarnings(from: string, to: string): Promise<EarningsRow[]> {
  const queryFrom = String(from || "").trim();
  const queryTo = String(to || "").trim();
  if (!queryFrom || !queryTo) return fetchEarnings();

  const json = await apiGet<EarningsResponse | EarningsRow[]>(
    `/api/earnings/calendar?from=${encodeURIComponent(queryFrom)}&to=${encodeURIComponent(queryTo)}`,
    { cache: "no-store" }
  );

  const rawRows = Array.isArray(json)
    ? json
    : (Array.isArray((json as EarningsResponse).data) ? (json as EarningsResponse).data || [] : []);

  return rawRows.map((row) => {
    const mappedRow = {
      ...row,
      event_date: String((row as Record<string, unknown>).event_date || ""),
      tradeability: String((row as Record<string, unknown>).tradeability || ""),
    };
    validateEarningsPayload(mappedRow as Record<string, unknown>);
    return mappedRow;
  }) as EarningsRow[];
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
