import type { HeatmapRow } from "@/lib/types";

export function SectorLeaderboard({ rows }: { rows: HeatmapRow[] }) {
  const bySector = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.sector] = (acc[row.sector] || 0) + row.change_percent;
    return acc;
  }, {});

  const ranked = Object.entries(bySector)
    .map(([sector, value]) => ({ sector, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Sector Momentum</div>
      <div className="space-y-2">
        {ranked.map((row) => (
          <div key={row.sector} className="flex items-center justify-between text-sm">
            <span className="text-slate-300">{row.sector}</span>
            <span className={row.value >= 0 ? "text-bull" : "text-bear"}>{row.value.toFixed(2)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
