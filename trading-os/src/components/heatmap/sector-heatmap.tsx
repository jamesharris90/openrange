"use client";

import { hierarchy, treemap } from "d3-hierarchy";
import { useMemo, useState } from "react";

import { Sparkline } from "@/components/terminal/sparkline";
import { useTickerStore } from "@/lib/store/ticker-store";
import type { HeatmapRow } from "@/lib/types";

const metrics = ["market_cap", "volume_24h", "gap_percent", "relative_volume", "institutional_flow_score"] as const;

export function SectorHeatMap({ rows }: { rows: HeatmapRow[] }) {
  const liveRows = useTickerStore((state) => state.heatmap);
  const sourceRows = liveRows.length > 0 ? liveRows : rows;
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [metric, setMetric] = useState<(typeof metrics)[number]>("market_cap");

  const grouped = useMemo(() => {
    const bySector = new Map<string, HeatmapRow[]>();
    for (const row of sourceRows) {
      const sector = row.sector || "Unknown";
      const list = bySector.get(sector) || [];
      list.push(row);
      bySector.set(sector, list);
    }
    return bySector;
  }, [sourceRows]);

  const renderRows = useMemo(
    () => (selectedSector ? grouped.get(selectedSector) || [] : sourceRows),
    [grouped, sourceRows, selectedSector]
  );

  const layout = useMemo(() => {
    const root = hierarchy({
      children: renderRows.map((row) => ({
        ...row,
        value: Math.max(1, Number(row[metric] || 0)),
      })),
    } as { children: Array<HeatmapRow & { value: number }> }).sum((d: unknown) => Number((d as { value?: number }).value || 0));

    return treemap<{ children: Array<HeatmapRow & { value: number }> }>()
      .size([1000, 420])
      .padding(4)(root)
      .leaves();
  }, [renderRows, metric]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="text-xs uppercase tracking-wide text-slate-400">Heat Map</div>
        {metrics.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setMetric(item)}
            className={`rounded-md border px-2 py-1 text-[11px] ${item === metric ? "border-blue-400 bg-blue-500/20 text-blue-200" : "border-slate-700 text-slate-400"}`}
          >
            {item}
          </button>
        ))}
        {selectedSector && (
          <button
            type="button"
            onClick={() => setSelectedSector(null)}
            className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300"
          >
            Back to sectors
          </button>
        )}
      </div>

      {!selectedSector && (
        <div className="mb-3 flex flex-wrap gap-2">
          {Array.from(grouped.keys()).map((sector) => (
            <button
              key={sector}
              onClick={() => setSelectedSector(sector)}
              type="button"
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-900"
            >
              {sector}
            </button>
          ))}
        </div>
      )}

      <svg viewBox="0 0 1000 420" className="h-[420px] w-full rounded-xl bg-slate-950">
        {layout.map((node) => {
          const row = node.data as unknown as HeatmapRow;
          const change = Number(row.change_percent || 0);
          const up = change >= 0;
          return (
            <g key={row.symbol} transform={`translate(${node.x0},${node.y0})`}>
              <rect
                width={Math.max(1, node.x1 - node.x0)}
                height={Math.max(1, node.y1 - node.y0)}
                fill={up ? "rgba(22,199,132,0.35)" : "rgba(234,57,67,0.35)"}
                stroke="rgba(30,41,59,0.9)"
                strokeWidth="1"
                rx="8"
              />
              <foreignObject x="8" y="8" width={Math.max(1, node.x1 - node.x0 - 16)} height={Math.max(1, node.y1 - node.y0 - 16)}>
                <div className="flex h-full w-full flex-col justify-between text-[11px] text-slate-100">
                  <div>
                    <div className="font-mono">{row.symbol}</div>
                    <div className={up ? "text-bull" : "text-bear"}>{change.toFixed(2)}%</div>
                  </div>
                  <Sparkline values={row.sparkline || [1, 2, 3, 2, 4]} width={100} height={24} />
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
