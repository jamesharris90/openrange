import type { Opportunity } from "@/lib/types";

import { apiGet } from "@/lib/api/client";
import { adaptCatalystsPayload } from "@/lib/adapters";

export async function getCatalystSignals(): Promise<Record<string, Opportunity[]>> {
  const response = await apiGet<Record<string, unknown>>("/api/intelligence/catalysts?limit=60");
  const rows = adaptCatalystsPayload(response).map((item) => {
    const confidence = Math.max(1, Math.min(99, item.impactScore * 10));
    return {
      symbol: item.symbol,
      strategy: item.catalystType,
      probability: confidence,
      confidence,
      expected_move: Number.NaN,
      catalyst: item.headline,
      source: item.source,
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

  const response = await apiGet<Record<string, unknown>>(`/api/intelligence/catalysts?symbol=${encodeURIComponent(normalized)}&limit=60`);
  const combined = adaptCatalystsPayload(response)
    .filter((item) => item.symbol === normalized)
    .map((item) => {
      const confidence = Math.max(1, Math.min(99, item.impactScore * 10));
      return {
        symbol: item.symbol,
        strategy: item.catalystType,
        probability: confidence,
        confidence,
        expected_move: Number.NaN,
        catalyst: item.headline,
        source: item.source,
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
