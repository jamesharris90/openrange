import { normalizeDataSource } from "@/lib/data-source";

import { asArray, asObject, asString } from "./parse";
import { adaptOpportunitiesPayload } from "./opportunities-adapter";

export type DashboardPayload = {
  source: string;
  sectors: Record<string, unknown>[];
  opportunities: ReturnType<typeof adaptOpportunitiesPayload>;
  earnings: {
    today: Record<string, unknown>[];
    week: Record<string, unknown>[];
  };
  news: Record<string, unknown>[];
  top_strategies: Record<string, unknown>[];
  warnings: string[];
  generated_at: string;
};

export function adaptDashboardPayload(payload: unknown): DashboardPayload {
  const root = asObject(payload);
  const data = asObject(root.data);
  const summary = asObject(data.summary);
  const earnings = asObject(summary.earnings);

  return {
    source: normalizeDataSource(summary.source ?? data.source ?? root.source),
    sectors: asArray(summary.sectors),
    opportunities: adaptOpportunitiesPayload({ data: summary.opportunities }),
    earnings: {
      today: asArray(earnings.today),
      week: asArray(earnings.week),
    },
    news: asArray(summary.news),
    top_strategies: asArray(summary.top_strategies),
    warnings: (asArray(data.warnings).map((entry) => asString(entry.message || entry.code || ""))).filter(Boolean),
    generated_at: asString(data.generated_at),
  };
}
