"use client";

import { useQuery } from "@tanstack/react-query";

import { ChartEngine } from "@/components/charts/chart-engine";
import { NarrativePanel } from "@/components/terminal/narrative-panel";
import { ProbabilityBar } from "@/components/terminal/probability-bar";
import { TechnicalGauge } from "@/components/terminal/technical-gauge";
import { getTickerEarnings } from "@/lib/api/earnings";
import { getResearchOverview } from "@/lib/api/stocks";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";
import { useTickerStore } from "@/lib/store/ticker-store";

export function ResearchView({ ticker }: { ticker: string }) {
  const timeframe = useTickerStore((state) => state.selectedTimeframe);
  const setTimeframe = useTickerStore((state) => state.setTimeframe);

  const { data: overview } = useQuery({
    queryKey: queryKeys.research(ticker),
    queryFn: () => getResearchOverview(ticker),
    ...QUERY_POLICY.slow,
  });

  const { data: earnings = [] } = useQuery({
    queryKey: [...queryKeys.research(ticker), "earnings"],
    queryFn: () => getTickerEarnings(ticker),
    ...QUERY_POLICY.slow,
  });

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Company Overview</div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400">Symbol</div>
            <div className="font-mono text-sm text-slate-100">{overview?.symbol || ticker}</div>
          </div>
          <div className="rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400">Price</div>
            <div className="font-mono text-sm text-slate-100">${Number(overview?.price || 0).toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400">Sector</div>
            <div className="text-sm text-slate-100">{overview?.sector || "N/A"}</div>
          </div>
          <div className="rounded-xl border border-slate-800 p-3">
            <div className="text-xs text-slate-400">Market Cap</div>
            <div className="text-sm text-slate-100">{Number(overview?.market_cap || 0).toLocaleString()}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <ChartEngine ticker={ticker} timeframe="daily" />
        <div className="space-y-3">
          <TechnicalGauge score={68} timeframe={timeframe} onTimeframeChange={setTimeframe} />
          <ProbabilityBar value={72} />
          <NarrativePanel ticker={ticker} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Earnings Intelligence</div>
        <div className="space-y-2">
          {earnings.slice(0, 6).map((row) => (
            <div key={`${row.symbol}-${row.earnings_date}`} className="grid rounded-lg border border-slate-800 p-2 text-xs text-slate-300 md:grid-cols-6">
              <span>{row.earnings_date}</span>
              <span>{(row.expected_move ?? 0).toFixed(2)}%</span>
              <span>{(row.actual_move ?? 0).toFixed(2)}%</span>
              <span>{row.beat_miss || "N/A"}</span>
              <span>{(row.post_earnings_move ?? 0).toFixed(2)}%</span>
              <span>{row.analyst_revisions || "N/A"}</span>
            </div>
          ))}
          {earnings.length === 0 && <div className="text-xs text-slate-500">No earnings intelligence available.</div>}
        </div>
      </section>
    </div>
  );
}
