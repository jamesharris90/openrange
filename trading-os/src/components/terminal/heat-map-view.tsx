"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { getHeatmapRows } from "@/lib/api/heatmap";
import { QUERY_POLICY } from "@/lib/queries/policy";
import { useTickerStore } from "@/lib/store/ticker-store";
import { bucketBy, toNum } from "@/lib/cockpit/rules";
import { SymbolLogo } from "@/components/terminal/metric-visuals";

type HeatmapRow = {
  symbol?: string;
  sector?: string;
  market_cap?: number;
  change_percent?: number;
};

type ContextState = {
  symbol: string;
  x: number;
  y: number;
};

function tone(change: number) {
  if (change > 0) return "bg-emerald-500/16 text-emerald-400 border-emerald-400/30";
  if (change < 0) return "bg-rose-500/16 text-rose-400 border-rose-400/30";
  return "bg-amber-500/12 text-amber-400 border-amber-400/30";
}

export function HeatMapView() {
  const router = useRouter();
  const addWatch = useTickerStore((state) => state.addWatch);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["cockpit", "heatmap", "rows"],
    queryFn: getHeatmapRows,
    ...QUERY_POLICY.medium,
  });

  const rows = useMemo(() => (Array.isArray(data) ? data : []) as HeatmapRow[], [data]);

  const bySector = useMemo(() => bucketBy(rows, (row) => String(row.sector || "Unknown")), [rows]);

  const sectorCards = useMemo(() => {
    return Object.entries(bySector)
      .map(([sector, list]) => {
        const avgChange = list.reduce((sum, item) => sum + toNum(item.change_percent), 0) / Math.max(list.length, 1);
        const totalCap = list.reduce((sum, item) => sum + toNum(item.market_cap), 0);
        return { sector, count: list.length, avgChange, totalCap };
      })
      .sort((a, b) => b.totalCap - a.totalCap);
  }, [bySector]);

  const detailRows = useMemo(() => {
    const active = selectedSector || sectorCards[0]?.sector;
    const list = bySector[active] || [];
    const maxCap = Math.max(...list.map((row) => toNum(row.market_cap, 0)), 1);

    return list
      .map((row) => {
        const cap = toNum(row.market_cap, 0);
        const change = toNum(row.change_percent, 0);
        const size = Math.max((cap / maxCap) * 120, 38);
        return {
          symbol: String(row.symbol || ""),
          change,
          size,
          cap,
        };
      })
      .sort((a, b) => b.cap - a.cap);
  }, [bySector, selectedSector, sectorCards]);

  const strongestSector = sectorCards.length > 0 ? [...sectorCards].sort((a, b) => b.avgChange - a.avgChange)[0] : null;
  const weakestSector = sectorCards.length > 0 ? [...sectorCards].sort((a, b) => a.avgChange - b.avgChange)[0] : null;

  if (isLoading) {
    return <div className="cockpit-card text-[var(--muted-foreground)]">Loading sector heatmap...</div>;
  }

  if (isError) {
    console.error("[heatmap] failed to load rows");
    return <div className="cockpit-card text-red-400">Heatmap failed. No silent fallback enabled.</div>;
  }

  if (!rows.length) {
    console.error("[heatmap] no rows returned");
    return <div className="cockpit-card text-red-400">Heatmap data incomplete. Rendering blocked by failsafe.</div>;
  }

  return (
    <div className="space-y-4">
      <section className="cockpit-card">
        <div className="text-xs uppercase text-[var(--muted-foreground)] mb-2">Capital Flow</div>
        <div className="grid gap-2 md:grid-cols-2">
          <button
            type="button"
            onClick={() => strongestSector && router.push(`/stocks-in-play?sector=${encodeURIComponent(strongestSector.sector)}`)}
            className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-left"
          >
            <div className="text-[11px] uppercase text-emerald-300">Strongest Sector</div>
            <div className="text-sm text-white mt-1">{strongestSector?.sector || "N/A"}</div>
            <div className="text-xs text-emerald-200 mt-1">Money rotating into {strongestSector?.sector || "leadership"}</div>
          </button>
          <button
            type="button"
            onClick={() => weakestSector && router.push(`/stocks-in-play?sector=${encodeURIComponent(weakestSector.sector)}`)}
            className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-left"
          >
            <div className="text-[11px] uppercase text-rose-300">Weakest Sector</div>
            <div className="text-sm text-white mt-1">{weakestSector?.sector || "N/A"}</div>
            <div className="text-xs text-rose-200 mt-1">Money rotating out of {weakestSector?.sector || "laggards"}</div>
          </button>
        </div>
      </section>

      <section className="cockpit-card">
        <div className="text-xs uppercase text-[var(--muted-foreground)] mb-3">Sector Blocks</div>
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {sectorCards.map((sector) => (
            <button
              key={sector.sector}
              onClick={() => setSelectedSector(sector.sector)}
              className={`group rounded-xl border p-3 text-left transition hover:scale-[1.02] hover:shadow-xl ${tone(sector.avgChange)} ${selectedSector === sector.sector ? "ring-2 ring-white/30" : ""}`}
            >
              <div className="text-xs font-semibold text-[var(--foreground)]">{sector.sector}</div>
              <div className="text-[11px]">{sector.count} tickers</div>
              <div className="text-[11px]">{sector.avgChange.toFixed(2)}%</div>
              <div className="mt-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 text-[10px] text-[var(--muted-foreground)]">Click to drill into actionable names</div>
            </button>
          ))}
        </div>
      </section>

      <section className="cockpit-card">
        <div className="text-xs uppercase text-[var(--muted-foreground)] mb-3">{selectedSector || sectorCards[0]?.sector || "Sector"} Drilldown</div>
        <div className="w-full min-h-[520px] rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
          <div className="flex flex-wrap gap-2">
            {detailRows.map((row) => (
              <button
                key={row.symbol}
                type="button"
                onClick={() => router.push(`/research/${row.symbol}`)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ symbol: row.symbol, x: event.clientX, y: event.clientY });
                }}
                className={`rounded-xl border p-2 ${tone(row.change)}`}
                style={{ width: `${row.size}px`, height: `${row.size}px` }}
                title={`${row.symbol} ${row.change.toFixed(2)}%`}
              >
                <SymbolLogo symbol={row.symbol} />
                <div className="text-[10px] text-[var(--foreground)] mt-1 font-semibold">{row.symbol}</div>
                <div className="text-[10px]">{row.change.toFixed(2)}%</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[170px] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="w-full rounded px-3 py-2 text-left text-xs hover:bg-[var(--muted)]" onClick={() => router.push(`/research/${contextMenu.symbol}`)}>Open in Research</button>
          <button type="button" className="w-full rounded px-3 py-2 text-left text-xs hover:bg-[var(--muted)]" onClick={() => router.push(`/alerts?ticker=${contextMenu.symbol}`)}>Add Alert</button>
          <button type="button" className="w-full rounded px-3 py-2 text-left text-xs hover:bg-[var(--muted)]" onClick={() => addWatch(contextMenu.symbol)}>Add to Watchlist</button>
        </div>
      ) : null}
    </div>
  );
}
