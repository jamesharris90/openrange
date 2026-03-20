"use client";

import { useQuery } from "@tanstack/react-query";

import { SectorHeatMap } from "@/components/heatmap/sector-heatmap";
import { getHeatmapRows } from "@/lib/api/heatmap";
import { percentSafe, toFixedSafe, toNumber } from "@/lib/number";
import { QUERY_POLICY } from "@/lib/queries/policy";

export function HeatMapView() {
  const { data = [] } = useQuery({
    queryKey: ["medium", "heatmapRows"],
    queryFn: getHeatmapRows,
    ...QUERY_POLICY.medium,
  });

  const safeData = data.map((row) => ({
    ...row,
    value: toNumber((row as unknown as { value?: unknown }).value, 0),
    probability: toNumber((row as unknown as { probability?: unknown }).probability, 0),
    confidence: toNumber((row as unknown as { confidence?: unknown }).confidence, 0),
    change_percent: toNumber(row.change_percent, 0),
  }));

  const displayData = safeData;
  console.log("COMPONENT DATA:", displayData);

  const sortedByMove = displayData
    .slice()
    .sort((a, b) => Math.abs(toNumber(b.change_percent, 0)) - Math.abs(toNumber(a.change_percent, 0)));
  const top = sortedByMove[0];

  if (displayData.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg text-xs text-slate-500">
        No data available
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Tracked Symbols</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">{displayData.length}</div>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Top Relative Volume</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">{toFixedSafe(toNumber(top?.relative_volume, 0), 2)}x</div>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Largest Move</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">
            {top ? `${top.symbol} ${percentSafe(toNumber(top.change_percent, 0), 2)}` : "N/A"}
          </div>
        </article>
      </section>
      <SectorHeatMap rows={displayData} />
    </div>
  );
}
