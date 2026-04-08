import type { Opportunity } from "@/lib/types";

import { apiGet } from "@/lib/api/client";
import { adaptOpportunitiesPayload } from "@/lib/adapters";
import { debugLog } from "@/lib/debug";

export type StocksFilters = {
  minPrice?: number;
  maxPrice?: number;
  minRvol?: number;
  minGap?: number;
  sector?: string;
  minMarketCap?: number;
  maxMarketCap?: number;
};

function normalizeRows(payload: unknown): Opportunity[] {
  const rows = adaptOpportunitiesPayload(payload);
  return Array.isArray(rows) ? rows : [];
}

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
  try {
    const response = await apiGet<Record<string, unknown>>("/api/intelligence/opportunities");
    debugLog("/api/intelligence/opportunities", response);
    return normalizeRows(response);
  } catch (error) {
    debugLog("/api/intelligence/opportunities error", error);
    return [];
  }
}

export async function getStocksInPlay(filters: StocksFilters = {}): Promise<Opportunity[]> {
  const query = buildQuery(filters);
  const endpoint = `/api/intelligence/opportunities${query ? `?${query}` : ""}`;
  try {
    const response = await apiGet<Record<string, unknown>>(endpoint);
    debugLog("/api/intelligence/opportunities", response);
    return normalizeRows(response);
  } catch (error) {
    debugLog("/api/intelligence/opportunities error", { endpoint, error });
    return [];
  }
}
