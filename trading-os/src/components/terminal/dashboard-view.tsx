"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { Sparkline } from "@/components/terminal/sparkline";
import { SectorLeaderboard } from "@/components/terminal/sector-leaderboard";
import { getDashboardSummary } from "@/lib/api/intelligence/dashboard";
import { getHeatmapRows } from "@/lib/api/heatmap";
import { getOpportunityStream } from "@/lib/api/opportunities";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";
import { useTickerStore } from "@/lib/store/ticker-store";

export function DashboardView() {
  const marketDataBanner = useTickerStore((state) => state.marketDataBanner);
  const showBanner = useTickerStore((state) => state.showBanner);
  const clearBanner = useTickerStore((state) => state.clearBanner);

  const { data: summary } = useQuery({
    queryKey: ["medium", "dashboardSummary"],
    queryFn: getDashboardSummary,
    ...QUERY_POLICY.medium,
  });

  const { data: opportunities = [] } = useQuery({
    queryKey: queryKeys.opportunityStream,
    queryFn: getOpportunityStream,
    ...QUERY_POLICY.medium,
  });

  const { data: heatmapRows = [] } = useQuery({
    queryKey: ["slow", "heatmap"],
    queryFn: getHeatmapRows,
    ...QUERY_POLICY.slow,
  });

  useEffect(() => {
    const hasOpportunities = opportunities.length > 0;
    const hasHeatmap = heatmapRows.length > 0;
    const hasNews = Number(summary?.news?.length || 0) > 0;
    const hasSignals = Number(summary?.top_strategies?.length || 0) > 0;
    const hasLiveData = hasOpportunities || hasHeatmap || hasNews || hasSignals;

    if (!hasLiveData) {
      showBanner("Market closed - displaying last known data");
      return;
    }

    clearBanner();
  }, [opportunities.length, heatmapRows.length, summary?.news?.length, summary?.top_strategies?.length, showBanner, clearBanner]);

  const cards = [
    {
      title: "Top Opportunities",
      value: opportunities.length,
      line: opportunities.slice(0, 12).map((item) => Number(item.probability || 0)),
    },
    {
      title: "Sectors Tracked",
      value: summary?.sectors?.length || 0,
      line: heatmapRows.slice(0, 12).map((item) => Number(item.change_percent || 0)),
    },
    {
      title: "Earnings Today",
      value: summary?.earnings?.today?.length || 0,
      line: (summary?.top_strategies || []).slice(0, 12).map((item) => Number(item.avg_score || 0)),
    },
    {
      title: "Catalyst News",
      value: summary?.news?.length || 0,
      line: (summary?.news || []).slice(0, 12).map((_, index) => index + 1),
    },
  ];

  return (
    <div className="space-y-4">
      {marketDataBanner ? (
        <section className="rounded-2xl border border-amber-700/40 bg-amber-900/20 p-3 text-xs font-medium tracking-wide text-amber-200">
          {marketDataBanner}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.title} className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">{card.title}</div>
            <div className="mb-2 text-2xl font-semibold text-slate-100">{card.value.toFixed(0)}</div>
            <Sparkline values={card.line} />
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Top Opportunities</div>
          <div className="space-y-2">
            {opportunities.slice(0, 8).map((row) => (
              <div key={`${row.symbol}-${row.strategy}`} className="flex items-center justify-between rounded-lg border border-slate-800 p-2">
                <div>
                  <div className="font-mono text-xs text-slate-100">{row.symbol}</div>
                  <div className="text-xs text-slate-400">{row.strategy}</div>
                </div>
                <div className="text-xs text-slate-300">P {row.probability.toFixed(0)}% | C {row.confidence.toFixed(0)}%</div>
              </div>
            ))}
            {opportunities.length === 0 && <div className="text-xs text-slate-500">No opportunities available.</div>}
          </div>
        </div>
        <SectorLeaderboard rows={heatmapRows} />
      </section>
    </div>
  );
}
