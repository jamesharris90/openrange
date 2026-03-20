import type { Opportunity } from "@/lib/types";

import { apiPost } from "@/lib/api/client";
import { cachedFetch } from "@/lib/cache";
import { debugLog } from "@/lib/debug";

type OpportunitiesResponse = {
  success?: boolean;
  data?: Opportunity[];
};

export async function fetchTopOpportunity(): Promise<Opportunity | null> {
  return cachedFetch("opportunities:top:single", async () => {
    const res = await fetch("/api/intelligence/top-opportunity", { cache: "no-store" });
    const json = (await res.json()) as OpportunitiesResponse;
    if (process.env.NODE_ENV === "development") {
      console.log("[TOP OPPORTUNITY]", json);
    }

    if (json.success !== true) {
      throw new Error("Top opportunity failed");
    }

    if (!Array.isArray(json.data)) {
      throw new Error("Top opportunity contract invalid");
    }

    return json.data[0] || null;
  });
}

export async function fetchOpportunities(): Promise<Opportunity[]> {
  return cachedFetch("opportunities:top", async () => {
    const res = await fetch("/api/intelligence/top-opportunity", { cache: "no-store" });
    const json = (await res.json()) as OpportunitiesResponse;

    if (json.success !== true) {
      throw new Error("Top opportunity failed");
    }

    if (!Array.isArray(json.data)) {
      throw new Error("Top opportunity contract invalid");
    }

    const rows = json.data;
    debugLog("fetchOpportunities", { count: rows.length });
    return rows;
  });
}

export const getOpportunityStream = fetchOpportunities;

export async function runGapScanner(): Promise<Opportunity[]> {
  const response = await apiPost<{ data?: Opportunity[] }>("/api/query/run", {
    query_tree: {
      AND: [
        { field: "gap_percent", operator: ">", value: 1 },
        { field: "relative_volume", operator: ">", value: 1 },
        { field: "volume", operator: ">", value: 500000 },
        { field: "price", operator: ">", value: 2 },
      ],
    },
    limit: 250,
  });
  if (!Array.isArray(response.data)) {
    throw new Error("No data returned from API");
  }
  return response.data;
}

export async function runScannerQuery(queryTree: unknown): Promise<Opportunity[]> {
  const response = await apiPost<{ data?: Opportunity[] }>("/api/query/run", { query_tree: queryTree, limit: 250 });
  if (!Array.isArray(response.data)) {
    throw new Error("No data returned from API");
  }
  return response.data;
}
