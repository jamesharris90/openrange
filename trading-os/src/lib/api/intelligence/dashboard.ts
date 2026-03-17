import { apiGet } from "@/lib/api/client";

export type DashboardSummary = {
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
  const response = await apiGet<{ data?: { summary?: DashboardSummary } }>("/api/intelligence/dashboard");
  const summary = response.data?.summary;
  return (
    summary || {
      sectors: [],
      opportunities: [],
      earnings: { today: [], week: [] },
      news: [],
      top_strategies: [],
    }
  );
}
