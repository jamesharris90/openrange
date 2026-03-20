import { apiGet } from "@/lib/api/client";

import {
  getEmailAnalytics,
  getSystemDiagnostics,
  triggerBroadcast,
} from "@/lib/api/intelligence/system";

type OpportunityStatusResponse = {
  count?: number;
  data?: Array<Record<string, unknown>>;
};

export type OpportunityEngineStatus = {
  totalOpportunities: number;
  lastUpdated: string | null;
  topSymbol: string | null;
};

export async function getOpportunityEngineStatus(): Promise<OpportunityEngineStatus> {
  const [opportunities, top] = await Promise.all([
    apiGet<OpportunityStatusResponse>("/api/intelligence/opportunities"),
    apiGet<OpportunityStatusResponse>("/api/intelligence/top-opportunity"),
  ]);

  const opportunityRows = Array.isArray(opportunities.data) ? opportunities.data : [];
  const topRow = Array.isArray(top.data) ? top.data[0] : undefined;
  const totalFromApi = typeof opportunities.count === "number" ? opportunities.count : opportunityRows.length;
  const lastUpdatedValue = topRow?.updated_at;

  return {
    totalOpportunities: totalFromApi,
    lastUpdated: typeof lastUpdatedValue === "string" ? lastUpdatedValue : null,
    topSymbol: typeof topRow?.symbol === "string" ? topRow.symbol : null,
  };
}

export { getSystemDiagnostics, getEmailAnalytics, triggerBroadcast };
