import type { Opportunity } from "@/lib/types";

import { apiGet } from "@/lib/api/client";

type CatalystRow = {
  symbol?: string;
  headline?: string;
  sentiment?: number;
  published_at?: string;
  source?: string;
};

function normalizeCatalystRows(payload: unknown): CatalystRow[] {
  if (Array.isArray(payload)) return payload as CatalystRow[];
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.data)) return p.data as CatalystRow[];
    if (Array.isArray(p.items)) return p.items as CatalystRow[];
  }
  return [];
}

export async function getCatalystSignals(): Promise<Record<string, Opportunity[]>> {
  const response = await apiGet<Record<string, unknown> | CatalystRow[]>("/api/catalysts?limit=60");
  const rows = normalizeCatalystRows(response).map((item) => {
    const sentiment = Number(item.sentiment || 0);
    const confidence = Math.max(1, Math.min(99, Math.round((Math.abs(sentiment) + 1) * 33)));
    return {
      symbol: String(item.symbol || "UNKNOWN").toUpperCase(),
      strategy: "NEWS CATALYST",
      probability: confidence,
      confidence,
      expected_move: Number.NaN,
      catalyst: String(item.headline || ""),
      source: String(item.source || "news"),
    } as Opportunity;
  });

  const deduped: Opportunity[] = [];
  const seen = new Set<string>();
  rows.forEach((row) => {
    const key = `${String(row.news_id ?? "none")}:${row.symbol}:${row.strategy}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(row);
  });

  return {
    catalysts: deduped,
    earnings: deduped.filter((row) => row.strategy.toLowerCase().includes("earn")),
    news: deduped.filter((row) => row.strategy.toLowerCase().includes("news")),
  };
}

export async function getCatalystSignalsBySymbol(symbol: string): Promise<Opportunity[]> {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return [];

  const response = await apiGet<Record<string, unknown> | CatalystRow[]>(`/api/catalysts?symbol=${encodeURIComponent(normalized)}&limit=60`);
  const combined = normalizeCatalystRows(response)
    .filter((item) => String(item.symbol || "").toUpperCase() === normalized)
    .map((item) => {
      const sentiment = Number(item.sentiment || 0);
      const confidence = Math.max(1, Math.min(99, Math.round((Math.abs(sentiment) + 1) * 33)));
      return {
        symbol: normalized,
        strategy: "NEWS CATALYST",
        probability: confidence,
        confidence,
        expected_move: Number.NaN,
        catalyst: String(item.headline || ""),
        source: String(item.source || "news"),
      } as Opportunity;
    });

  const seen = new Set<string>();
  return combined.filter((row) => {
    const key = `${String(row.news_id ?? "none")}:${row.symbol}:${row.strategy}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
