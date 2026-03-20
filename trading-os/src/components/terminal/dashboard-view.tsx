"use client";

import { useQuery } from "@tanstack/react-query";

import { DataState } from "@/components/system/data-state";
import { OpportunityCard } from "@/components/terminal/opportunity-card";
import { Sparkline } from "@/components/terminal/sparkline";
import { SectorLeaderboard } from "@/components/terminal/sector-leaderboard";
import { getCatalystSignals } from "@/lib/api/catalysts";
import { getDashboardSummary } from "@/lib/api/intelligence/dashboard";
import { getHeatmapRows } from "@/lib/api/heatmap";
import { percentSafe, toFixedSafe, toNumber } from "@/lib/number";
import { QUERY_POLICY } from "@/lib/queries/policy";
import { useTopOpportunity } from "@/lib/hooks/useTopOpportunity";

export function DashboardView() {
  const { data: summary } = useQuery({
    queryKey: ["medium", "dashboardSummary"],
    queryFn: getDashboardSummary,
    ...QUERY_POLICY.medium,
  });

  const { data } = useTopOpportunity();
  const topOpportunity = data?.[0] ?? null;

  const { data: catalysts } = useQuery({
    queryKey: ["medium", "catalysts-dashboard"],
    queryFn: getCatalystSignals,
    ...QUERY_POLICY.medium,
  });

  const { data: heatmapRows = [] } = useQuery({
    queryKey: ["slow", "heatmap"],
    queryFn: getHeatmapRows,
    ...QUERY_POLICY.slow,
  });

  const safeHeatmapRows = heatmapRows.map((row) => ({
    ...row,
    change_percent: toNumber(row.change_percent, 0),
  }));

  const hasOpportunities = Boolean(topOpportunity);
  const hasHeatmap = safeHeatmapRows.length > 0;
  const hasNews = Number(summary?.news?.length || 0) > 0;
  const hasSignals = Number(summary?.top_strategies?.length || 0) > 0;
  const hasLiveData = hasOpportunities || hasHeatmap || hasNews || hasSignals;

  const cards = [
    {
      title: "Top Opportunities",
      value: topOpportunity ? 1 : 0,
      line: [topOpportunity ? toNumber(topOpportunity.confidence, 0) : 0],
    },
    {
      title: "Sectors Tracked",
      value: summary?.sectors?.length || 0,
      line: safeHeatmapRows.slice(0, 20).map((item) => toNumber(item.change_percent, 0)),
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

  const top = topOpportunity;

  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.title} className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">{card.title}</div>
            <div className="mb-2 text-2xl font-semibold text-slate-100">{toFixedSafe(card.value, 0)}</div>
            <Sparkline values={card.line} />
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Execution Command Center</div>
          {top ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Symbol</div>
                <div>{String(top.symbol || "")}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Strategy</div>
                <div>{String(top.strategy || "")}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Expected Move %</div>
                <div>{percentSafe(toNumber(top.expected_move_percent, Number.NaN), 2)}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Entry</div>
                <div>{String(top.entry ?? "")}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Stop Loss</div>
                <div>{String(top.stop_loss ?? "")}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Take Profit</div>
                <div>{String(top.take_profit ?? "")}</div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-300">No active setup</div>
          )}
        </article>

        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Catalyst Pulse</div>
          <div className="space-y-2">
            {(catalysts?.catalysts || []).slice(0, 4).map((row, index) => (
              <div key={`${row.symbol}-${row.strategy}-${index}`} className="rounded-lg border border-slate-800 p-2">
                <div className="text-xs text-slate-100">
                  <span className="font-mono">{row.symbol}</span> {row.catalyst || row.strategy}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  Conviction {toFixedSafe(toNumber(row.confidence, 0), 0)}%
                </div>
              </div>
            ))}
            {(catalysts?.catalysts || []).length === 0 ? (
              <div className="text-xs text-slate-500">No catalyst events in stream.</div>
            ) : null}
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Top Opportunities</div>
          <DataState data={topOpportunity} emptyMessage="No opportunities in database">
            {topOpportunity ? <OpportunityCard data={topOpportunity} /> : null}
          </DataState>
        </div>
        <SectorLeaderboard rows={safeHeatmapRows} />
      </section>

      {!hasLiveData ? (
        <section className="rounded-2xl border border-slate-800 bg-panel p-3 text-xs text-slate-400">
          No data available
        </section>
      ) : null}
    </div>
  );
}
