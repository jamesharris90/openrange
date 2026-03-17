import type { Opportunity } from "@/lib/types";

import { apiGet } from "@/lib/api/client";

export type StocksFilters = {
  minPrice?: number;
  maxPrice?: number;
  minRvol?: number;
  minGap?: number;
  sector?: string;
  minMarketCap?: number;
  maxMarketCap?: number;
};

function buildQuery(filters: StocksFilters) {
  const query = new URLSearchParams();
  if (typeof filters.minPrice === "number") query.set("minPrice", String(filters.minPrice));
  if (typeof filters.maxPrice === "number") query.set("maxPrice", String(filters.maxPrice));
  if (typeof filters.minRvol === "number") query.set("minRvol", String(filters.minRvol));
  if (typeof filters.minGap === "number") query.set("minGap", String(filters.minGap));
  if (typeof filters.minMarketCap === "number") query.set("minMarketCap", String(filters.minMarketCap));
  if (typeof filters.maxMarketCap === "number") query.set("maxMarketCap", String(filters.maxMarketCap));
  if (filters.sector) query.set("sector", filters.sector);
  return query.toString();
}

export async function getOpportunityStream(): Promise<Opportunity[]> {
  const response = await apiGet<{ success?: boolean; data?: Opportunity[] }>("/api/intelligence/opportunities");
  if (response.success !== true) {
    throw new Error("Intelligence opportunities request failed");
  }

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid opportunities response contract");
  }

  return response.data;
}

export async function getStocksInPlay(filters: StocksFilters = {}): Promise<Opportunity[]> {
  const query = buildQuery(filters);
  const response = await apiGet<{ success?: boolean; data?: Opportunity[] }>(`/api/intelligence/opportunities${query ? `?${query}` : ""}`);
  if (response.success !== true) {
    throw new Error("Intelligence opportunities request failed");
  }

  if (!Array.isArray(response.data)) {
    throw new Error("Invalid opportunities response contract");
  }

  return response.data;
}
