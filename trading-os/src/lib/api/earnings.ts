import type { EarningsRow } from "@/lib/types";

import { apiGet } from "@/lib/api/client";

export async function getEarningsCalendar(): Promise<EarningsRow[]> {
  const response = await apiGet<{ earnings?: Array<Record<string, unknown>> }>("/api/earnings/calendar");
  if (!response.earnings) {
    throw new Error("No data returned from API");
  }
  return response.earnings.map((row) => ({
    symbol: String(row.symbol || "").toUpperCase(),
    company: String(row.companyName || ""),
    earnings_date: String(row.date || ""),
    expected_move: Number(row.surprisePercent || 0),
    actual_move: Number(row.changePercent || 0),
    beat_miss: Number(row.surprisePercent || 0) >= 0 ? "Beat" : "Miss",
    post_earnings_move: Number(row.preMarketChangePercent || 0),
    analyst_revisions: "N/A",
    sector: String(row.sector || ""),
  }));
}

export async function getTickerEarnings(ticker: string): Promise<EarningsRow[]> {
  const response = await apiGet<Array<Record<string, unknown>>>(`/api/earnings?symbol=${encodeURIComponent(ticker)}&limit=12`);
  if (!response) {
    throw new Error("No data returned from API");
  }
  return response.map((row) => ({
    symbol: String(row.symbol || ticker).toUpperCase(),
    earnings_date: String(row.date || ""),
    expected_move: Number(row.epsEstimate || 0),
    actual_move: Number(row.epsActual || 0),
    beat_miss: Number(row.epsActual || 0) >= Number(row.epsEstimate || 0) ? "Beat" : "Miss",
    post_earnings_move: 0,
    analyst_revisions: "N/A",
  }));
}
