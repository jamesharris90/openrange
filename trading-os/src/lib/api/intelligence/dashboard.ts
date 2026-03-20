import { apiGet } from "@/lib/api/client";
import { adaptDashboardPayload } from "@/lib/adapters";
import { debugLog } from "@/lib/debug";

export type DashboardSummary = {
  source: string;
  sectors: Array<Record<string, unknown>>;
  opportunities: Array<Record<string, unknown>>;
  earnings: {
    today: Array<Record<string, unknown>>;
    week: Array<Record<string, unknown>>;
  };
  news: Array<Record<string, unknown>>;
  top_strategies: Array<Record<string, unknown>>;
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const response = await apiGet<Record<string, unknown>>("/api/intelligence/dashboard");
  debugLog("/api/intelligence/dashboard", response);
  const adapted = adaptDashboardPayload(response);

  return {
    source: adapted.source,
    sectors: adapted.sectors,
    opportunities: adapted.opportunities,
    earnings: adapted.earnings,
    news: adapted.news,
    top_strategies: adapted.top_strategies,
  };
}
