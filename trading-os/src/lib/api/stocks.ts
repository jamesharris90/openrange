import type { Opportunity } from "@/lib/types";

import { apiGet } from "@/lib/api/client";
import { getStocksInPlay as getStocksInPlayBridge } from "@/lib/api/intelligence/opportunities";

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
  return apiGet<{ symbol: string; price?: number; sector?: string; market_cap?: number; volume?: number }>(
    `/api/quote?symbol=${encodeURIComponent(ticker)}`
  );
}
