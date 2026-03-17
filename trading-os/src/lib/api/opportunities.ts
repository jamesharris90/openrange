import type { Opportunity } from "@/lib/types";

import { apiPost } from "@/lib/api/client";
import { getOpportunityStream } from "@/lib/api/intelligence/opportunities";

export { getOpportunityStream };

export async function runGapScanner(): Promise<Opportunity[]> {
  const response = await apiPost<{ rows?: Opportunity[] }>("/api/query/run", {
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
  if (!response.rows) {
    throw new Error("No data returned from API");
  }
  return response.rows;
}

export async function runScannerQuery(queryTree: unknown): Promise<Opportunity[]> {
  const response = await apiPost<{ rows?: Opportunity[] }>("/api/query/run", { query_tree: queryTree, limit: 250 });
  if (!response.rows) {
    throw new Error("No data returned from API");
  }
  return response.rows;
}
