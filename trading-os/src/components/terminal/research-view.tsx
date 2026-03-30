"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ChartEngine } from "@/components/charts/chart-engine";
import { apiGet } from "@/lib/api/client";
import { getTickerEarnings } from "@/lib/api/earnings";
import { getNewsBySymbol } from "@/lib/api/news";
import { getResearchOverview } from "@/lib/api/stocks";
import { getDecision } from "@/lib/decisionEngine";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";
import { toNum } from "@/lib/cockpit/rules";
import { ConfidenceGauge, DecisionBadge, ExpectedMoveBar } from "@/components/terminal/metric-visuals";

type DecisionPayload = {
  symbol?: string;
  why_moving?: { narrative?: string; catalyst?: string; catalyst_type?: string };
  tradeability?: { rvol?: number; range_pct?: number; tradeability_score?: number };
  execution_plan?: { strategy?: string; entry_type?: string; risk_level?: string; setup_candidates?: Array<{ setup?: string }> };
  decision_score?: number;
};

type Opportunity = {
  symbol?: string;
  strategy?: string;
  expected_move_percent?: number;
  why_moving?: string;
  confidence?: number;
};

function logoUrl(symbol: string) {
  return `https://logo.clearbit.com/${symbol.toLowerCase()}.com`;
}

function keyLevels(price: number, expectedMovePct: number) {
  const move = price * (Math.abs(expectedMovePct) / 100);
  return {
    entry: price,
    stop: Math.max(price - move, 0),
    target: price + move,
  };
}

export function ResearchView({ ticker }: { ticker: string }) {
  const router = useRouter();
  const [search, setSearch] = useState(ticker);

  const overviewQuery = useQuery({
    queryKey: queryKeys.research(ticker),
    queryFn: () => getResearchOverview(ticker),
    ...QUERY_POLICY.medium,
  });

  const decisionQuery = useQuery({
    queryKey: ["cockpit", "research", ticker, "decision"],
    queryFn: () => apiGet<{ decision?: DecisionPayload }>(`/api/intelligence/decision/${encodeURIComponent(ticker)}`),
    ...QUERY_POLICY.fast,
  });

  const opportunitiesQuery = useQuery({
    queryKey: ["cockpit", "research", ticker, "opportunities"],
    queryFn: () => apiGet<{ data?: Opportunity[] }>("/api/intelligence/top-opportunities?limit=200"),
    ...QUERY_POLICY.fast,
  });

  const earningsQuery = useQuery({
    queryKey: ["cockpit", "research", ticker, "earnings"],
    queryFn: () => getTickerEarnings(ticker),
    ...QUERY_POLICY.medium,
  });

  const newsQuery = useQuery({
    queryKey: ["cockpit", "research", ticker, "news"],
    queryFn: () => getNewsBySymbol(ticker, 8),
    ...QUERY_POLICY.medium,
  });

  const loading = overviewQuery.isLoading || decisionQuery.isLoading || opportunitiesQuery.isLoading || earningsQuery.isLoading || newsQuery.isLoading;
  const opportunityForTicker = (opportunitiesQuery.data?.data || []).find((row) => String(row.symbol || "").toUpperCase() === ticker);
  const decision = decisionQuery.data?.decision;

  const price = toNum((overviewQuery.data as Record<string, unknown> | undefined)?.price, Number.NaN);
  const expectedMovePct = toNum(opportunityForTicker?.expected_move_percent, 0);
  const confidence = toNum(opportunityForTicker?.confidence, toNum(decision?.decision_score, 0));
  const levels = Number.isFinite(price) && price > 0 ? keyLevels(price, expectedMovePct) : null;
  const action = getDecision({
    confidence,
    relative_volume: decision?.tradeability?.rvol,
    market_session: "EARLY",
  });
  const rr = levels ? (levels.target - levels.entry) / Math.max(levels.entry - levels.stop, 0.01) : 0;

  const similarSetups = useMemo(() => {
    const currentStrategy = String(decision?.execution_plan?.strategy || "").toUpperCase();
    return (opportunitiesQuery.data?.data || [])
      .filter((row) => String(row.symbol || "").toUpperCase() !== ticker)
      .filter((row) => currentStrategy && String(row.strategy || "").toUpperCase() === currentStrategy)
      .slice(0, 6);
  }, [opportunitiesQuery.data, decision?.execution_plan?.strategy, ticker]);

  const riskScore = toNum(decision?.tradeability?.tradeability_score, 0);

  return (
    <div className="space-y-4 bg-[#0B0F14]">
      {/* Decision summary — only shown when data is available */}
      {(decision || opportunityForTicker) && (
        <section className="cockpit-card bg-[#121826] border-[#1F2937]">
          <div className="text-xs uppercase text-gray-400">What Should I Do?</div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <DecisionBadge action={action.action} urgency={action.urgency} size="lg" />
            {confidence > 0 && <ConfidenceGauge value={confidence} size={86} />}
            {expectedMovePct !== 0 && (
              <div className="min-w-[220px]">
                <div className="text-[11px] text-gray-400 uppercase">Expected Move</div>
                <ExpectedMoveBar expectedMovePercent={expectedMovePct} changePercent={0} />
              </div>
            )}
          </div>
          {loading ? (
            <div className="mt-3 text-xs text-gray-500">Loading decision data…</div>
          ) : (
            <div className="mt-3 rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3 text-sm text-cyan-100">
              {action.action}: {action.reason}
            </div>
          )}
        </section>
      )}

      <section className="cockpit-card bg-[#121826] border-[#1F2937]">
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value.toUpperCase())}
            placeholder="Search ticker"
            className="flex-1 rounded-xl border border-[#1F2937] bg-[#0B0F14] px-3 py-2 text-white text-sm"
          />
          <button
            className="rounded-xl border border-[#1F2937] px-3 py-2 text-xs text-gray-400"
            onClick={() => {
              const target = search.trim().toUpperCase();
              if (target) router.push(`/research/${target}`);
            }}
          >
            Load
          </button>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[6fr_4fr]">
        <div className="space-y-4">
          <div className="cockpit-card bg-[#121826] border-[#1F2937]">
            <div className="text-xs uppercase text-gray-400 mb-2">Chart</div>
            <ChartEngine ticker={ticker} timeframe="daily" />
          </div>

          {levels && (
            <div className="cockpit-card bg-[#121826] border-[#1F2937]">
              <div className="text-xs uppercase text-gray-400 mb-2">Key Levels</div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
                  <div className="text-gray-400 text-xs">Entry</div>
                  <div className="text-white font-semibold">${levels.entry.toFixed(2)}</div>
                </div>
                <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
                  <div className="text-gray-400 text-xs">Stop</div>
                  <div className="text-red-400 font-semibold">${levels.stop.toFixed(2)}</div>
                </div>
                <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
                  <div className="text-gray-400 text-xs">Target</div>
                  <div className="text-green-400 font-semibold">${levels.target.toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="cockpit-card bg-[#121826] border-[#1F2937]">
            <div className="text-xs uppercase text-gray-400">Why Moving</div>
            <div className="text-white text-sm mt-2">
              {decision?.why_moving?.narrative || opportunityForTicker?.why_moving || <span className="text-gray-500">No catalyst data available</span>}
            </div>
          </div>

          {decision && (
            <div className="cockpit-card bg-[#121826] border-[#1F2937]">
              <div className="text-xs uppercase text-gray-400">Trade Plan</div>
              <div className="text-white text-sm mt-2">Strategy: {String(decision.execution_plan?.strategy || "—")}</div>
              {levels && (
                <div className="text-gray-300 text-xs mt-1">
                  Entry ${levels.entry.toFixed(2)} · Stop ${levels.stop.toFixed(2)} · Target ${levels.target.toFixed(2)} · R:R {rr.toFixed(2)}:1
                </div>
              )}
            </div>
          )}

          {confidence > 0 && (
            <div className="cockpit-card bg-[#121826] border-[#1F2937]">
              <div className="text-xs uppercase text-gray-400">Confidence</div>
              <div className="mt-2 flex items-center gap-3">
                <ConfidenceGauge value={confidence} size={84} />
                <div className="text-white text-sm">{confidence.toFixed(0)}%</div>
              </div>
            </div>
          )}

          {similarSetups.length > 0 && (
            <div className="cockpit-card bg-[#121826] border-[#1F2937]">
              <div className="text-xs uppercase text-gray-400">Similar Setups</div>
              <div className="space-y-2 mt-2">
                {similarSetups.map((row) => (
                  <div key={`${row.symbol}-${row.strategy}`} className="rounded-lg border border-[#1F2937] bg-[#0B0F14] p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <img src={logoUrl(String(row.symbol || ""))} alt={`${row.symbol} logo`} className="h-4 w-4 rounded-full border border-[#1F2937]" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      <span className="text-white">{String(row.symbol || "")}</span>
                    </div>
                    <div className="text-gray-400 mt-1">{String(row.strategy || "EVENT_DRIVEN")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="cockpit-card bg-[#121826] border-[#1F2937]">
          <div className="text-xs uppercase text-gray-400">Risk Panel</div>
          <div className="text-white text-sm mt-2">Tradeability Score: {riskScore.toFixed(2)}</div>
          <div className="text-gray-400 text-xs mt-1">Earnings records: {(earningsQuery.data || []).length}</div>
        </div>

        <div className="cockpit-card bg-[#121826] border-[#1F2937]">
          <div className="text-xs uppercase text-gray-400">Market Intelligence</div>
          <div className="text-white text-sm mt-2">Expected Move: {expectedMovePct !== 0 ? `${expectedMovePct.toFixed(2)}%` : "—"}</div>
          <div className="text-gray-400 text-xs mt-1">News records: {(newsQuery.data || []).length}</div>
        </div>
      </section>
    </div>
  );
}
