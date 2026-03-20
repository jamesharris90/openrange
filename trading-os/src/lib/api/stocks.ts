import type { Opportunity } from "@/lib/types";

import { apiGet } from "@/lib/api/client";
import { adaptMarketQuotesPayload } from "@/lib/adapters";
import { getStocksInPlay as getStocksInPlayBridge } from "@/lib/api/intelligence/opportunities";
import { normalizeDataSource } from "@/lib/data-source";

export type StocksFilters = {
  minPrice?: number;
  maxPrice?: number;
  minRvol?: number;
  minGap?: number;
  sector?: string;
  minMarketCap?: number;
  maxMarketCap?: number;
  minProbability?: number;
  minConfidence?: number;
};

export async function getStocksInPlay(filters: StocksFilters = {}): Promise<Opportunity[]> {
  return getStocksInPlayBridge(filters);
}

export async function getResearchOverview(ticker: string) {
  const response = await apiGet<Record<string, unknown>>(
    `/api/intelligence/markets?symbols=${encodeURIComponent(ticker)}`
  );
  const normalized = adaptMarketQuotesPayload(response);
  const row = normalized.find((item) => item.symbol === ticker.toUpperCase());

  if (!row) {
    return {
      symbol: ticker,
      source: "none" as const,
    };
  }

  return {
    symbol: row.symbol,
    price: row.price,
    change_percent: row.change_percent,
    volume: row.volume_24h,
    sector: String(row.sector || ""),
    market_cap: Number(row.market_cap),
    source: normalizeDataSource(row.source || "none"),
  };
}
