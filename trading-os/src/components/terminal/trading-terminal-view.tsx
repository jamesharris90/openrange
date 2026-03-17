"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Group, Panel, Separator } from "react-resizable-panels";

import { ChartEngine } from "@/components/charts/chart-engine";
import { ConfidenceMeter } from "@/components/terminal/confidence-meter";
import { NarrativePanel } from "@/components/terminal/narrative-panel";
import { ProbabilityBar } from "@/components/terminal/probability-bar";
import { WatchlistPanel } from "@/components/terminal/watchlist-panel";
import { getMarketRegime } from "@/lib/api/markets";
import { useTickerStore } from "@/lib/store/ticker-store";
import { QUERY_POLICY } from "@/lib/queries/policy";

export function TradingTerminalView() {
  const searchParams = useSearchParams();
  const storeTicker = useTickerStore((state) => state.activeTicker);
  const ticker = searchParams.get("ticker")?.toUpperCase() || storeTicker;

  const { data: regime } = useQuery({
    queryKey: ["fast", "marketRegime"],
    queryFn: getMarketRegime,
    ...QUERY_POLICY.fast,
  });

  return (
    <div className="h-[calc(100vh-130px)] overflow-hidden rounded-2xl border border-slate-800 bg-background shadow-lg">
      <Group orientation="horizontal">
        <Panel defaultSize={20} minSize={16} collapsible className="overflow-y-auto p-3">
          <WatchlistPanel />
        </Panel>
        <Separator className="w-1 bg-slate-900" />

        <Panel defaultSize={55} minSize={40} className="overflow-y-auto p-3">
          <div className="grid gap-3 xl:grid-cols-3">
            <ChartEngine ticker={ticker} timeframe="daily" />
            <ChartEngine ticker={ticker} timeframe="5m" />
            <ChartEngine ticker={ticker} timeframe="1m" />
          </div>
        </Panel>
        <Separator className="w-1 bg-slate-900" />

        <Panel defaultSize={25} minSize={20} collapsible className="overflow-y-auto p-3">
          <div className="space-y-3">
            <NarrativePanel ticker={ticker} />
            <ProbabilityBar value={71} />
            <ConfidenceMeter value={78} />
            <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Risk Targets</div>
              <div className="mb-2 text-xs text-slate-400">Regime: {regime?.regime || "Neutral"}</div>
              <div className="space-y-1 text-xs text-slate-200">
                <div>Risk: -1.4%</div>
                <div>Target 1: +2.2%</div>
                <div>Target 2: +3.8%</div>
              </div>
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  );
}
