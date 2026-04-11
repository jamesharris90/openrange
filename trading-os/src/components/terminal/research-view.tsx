"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ChartEngine } from "@/components/charts/chart-engine";
import { apiGet } from "@/lib/api/client";
import { getTickerEarnings } from "@/lib/api/earnings";
import { getNewsBySymbol } from "@/lib/api/news";
import { getResearchOverview } from "@/lib/api/stocks";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";
import { toNum } from "@/lib/cockpit/rules";
import { ConfidenceGauge, DecisionBadge, ExpectedMoveBar } from "@/components/terminal/metric-visuals";

type DecisionPayload = {
  symbol?: string;
  action?: string;
  urgency?: string;
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

type PremarketIntel = {
  premarket_trend?: string | null;
  premarket_range_percent?: number | null;
  premarket_gap_confidence?: string | null;
  premarket_signal_type?: string | null;
  premarket_valid?: boolean | null;
  premarket_gap?: number | null;
  premarket_volume?: number | null;
  premarket_candles?: number | null;
  premarket_data_quality?: number | null;
  // Execution layer
  entry_price?: number | null;
  stop_price?: number | null;
  target_price?: number | null;
  risk_percent?: number | null;
  reward_percent?: number | null;
  risk_reward_ratio?: number | null;
  execution_valid?: boolean | null;
  execution_type?: string | null;
  position_size_shares?: number | null;
  position_size_value?: number | null;
  // Refinement layer
  entry_confirmed?: boolean | null;
  breakout_strength?: number | null;
  session_phase?: string | null;
  execution_rating?: string | null;
  execution_notes?: string | null;
};

// ─── Frontend fallback generators ─────────────────────────────────────────────

function generateResearchWhy(
  overview: Record<string, unknown> | undefined,
  decision: DecisionPayload | undefined,
  opportunity: Opportunity | undefined,
  price: number,
): string {
  // Try backend fields first
  const narrative = decision?.why_moving?.narrative;
  if (narrative && String(narrative).trim().length > 8) return String(narrative);
  const catalyst = decision?.why_moving?.catalyst;
  if (catalyst && String(catalyst).trim().length > 8) return String(catalyst);
  const oppWhy = opportunity?.why_moving;
  if (oppWhy && String(oppWhy).trim().length > 8) return String(oppWhy);

  // Generate from available data
  const chgRaw = (overview as { change_percent?: unknown } | undefined)?.change_percent;
  const chg = Number.isFinite(Number(chgRaw)) ? Number(chgRaw) : 0;
  const dir = chg > 0 ? "up" : chg < 0 ? "down" : "flat";

  if (Math.abs(chg) > 5)
    return `Strong ${dir} move of ${Math.abs(chg).toFixed(1)}% — significant directional pressure. Check news and catalyst scanner for the driver.`;
  if (Math.abs(chg) > 2)
    return `Moderate ${dir} movement of ${Math.abs(chg).toFixed(1)}%. Watching for catalyst confirmation before trading.`;
  if (Number.isFinite(price) && price > 0)
    return `Price at $${price.toFixed(2)} — no catalyst signal yet. Will update when the engine scores this ticker.`;
  return `No catalyst data available yet. The engine evaluates signals every 10 minutes during market hours.`;
}

function generateResearchHow(
  decision: DecisionPayload | undefined,
  opportunity: Opportunity | undefined,
  actionStr: string,
): string {
  const strat = String(decision?.execution_plan?.strategy || opportunity?.strategy || "").toLowerCase();
  const entryType = String(decision?.execution_plan?.entry_type || "").toLowerCase();
  const setupCandidates = decision?.execution_plan?.setup_candidates ?? [];

  if (setupCandidates.length > 0) {
    const setups = setupCandidates.slice(0, 2).map(s => s.setup).filter(Boolean).join(" or ");
    return `Look for a ${setups} setup. ${entryType ? `Entry type: ${entryType}. ` : ""}Risk per trade: £10 max.`;
  }
  if (strat.includes("gap"))
    return `Gap setup — wait for first 15-minute consolidation, enter break of premarket high, stop below premarket low.`;
  if (strat.includes("breakout"))
    return `Breakout — wait for volume confirmation above the key level before entering. Stop below breakout base.`;
  if (actionStr === "ENTER")
    return `Signal is live — enter at current price with stop below the nearest support. Size for £10 max risk.`;
  if (actionStr === "WATCH")
    return `Not yet triggering — watch for confirmation before entering. Set an alert at the key breakout level.`;
  if (actionStr === "AVOID")
    return `Setup doesn't meet criteria right now — wait for a cleaner pattern or check Stocks In Play for better setups.`;
  return `Wait for first 15-minute range to establish, then trade the break with volume confirmation.`;
}

function premarketNarrative(intel: PremarketIntel): string {
  const { premarket_signal_type, premarket_trend, premarket_gap } = intel;
  const gap = Math.abs(toNum(premarket_gap, 0));
  const gapDir = (premarket_gap ?? 0) >= 0 ? "up" : "down";

  switch (premarket_signal_type) {
    case "GAP_AND_GO":
      return `Stock gapped ${gapDir} ${gap.toFixed(1)}% premarket with strong upward trend and high-confidence volume. Classic gap-and-go setup — look for continuation above premarket high at the open.`;
    case "GAP_FADE":
      return `Stock gapped ${gapDir} ${gap.toFixed(1)}% but premarket trend is ${premarket_trend?.toLowerCase() ?? "down"}. Watch for fade back toward VWAP — sellers may dominate early price action.`;
    case "RANGE_BUILD":
      return `Tight premarket range with low volatility. Price is consolidating — wait for a clear break above or below range boundaries before committing.`;
    case "UNDEFINED":
      return `No clear premarket structure. Data is present but signal is ambiguous — treat as a watch-only until regular session confirms direction.`;
    default:
      return `Premarket data is pending analysis. Check back once market opens for updated signal classification.`;
  }
}

type ExecutionVerdict = "GOOD" | "WATCH" | "AVOID";

function executionVerdict(intel: PremarketIntel): ExecutionVerdict {
  const rr = toNum(intel.risk_reward_ratio, 0);
  if (intel.execution_valid && rr >= 2) return "GOOD";
  if (rr >= 1 && rr < 2)              return "WATCH";
  return "AVOID";
}

function executionFailureReasons(intel: PremarketIntel): string[] {
  const reasons: string[] = [];
  if (!intel.execution_valid) {
    if ((intel.risk_percent ?? 0) > 5)              reasons.push("Risk too high (>5%)");
    if ((intel.risk_reward_ratio ?? 0) < 1.5)       reasons.push("Poor R:R ratio (<1.5)");
    if (intel.premarket_gap_confidence === "LOW")    reasons.push("Low confidence gap");
    if (!intel.premarket_valid)                      reasons.push("Premarket signal not validated");
  }
  return reasons;
}

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

  const premarketQuery = useQuery({
    queryKey: ["cockpit", "research", ticker, "premarket"],
    queryFn: () => apiGet<{ data?: PremarketIntel[] }>(`/api/premarket/watchlist?symbol=${encodeURIComponent(ticker)}&limit=1`),
    ...QUERY_POLICY.medium,
  });
  const premarketIntel: PremarketIntel = premarketQuery.data?.data?.[0] ?? {};

  const loading = overviewQuery.isLoading || decisionQuery.isLoading || opportunitiesQuery.isLoading || earningsQuery.isLoading || newsQuery.isLoading;
  const opportunityForTicker = (opportunitiesQuery.data?.data || []).find((row) => String(row.symbol || "").toUpperCase() === ticker);
  const decision = decisionQuery.data?.decision;

  const price = toNum((overviewQuery.data as Record<string, unknown> | undefined)?.price, Number.NaN);
  const expectedMovePct = toNum(opportunityForTicker?.expected_move_percent, 0);
  const confidence = toNum(opportunityForTicker?.confidence, toNum(decision?.decision_score, 0));
  const levels = Number.isFinite(price) && price > 0 ? keyLevels(price, expectedMovePct) : null;
  const actionStr = (decision?.action ?? (confidence >= 70 ? "ENTER" : confidence >= 50 ? "WATCH" : "WAIT")) as import("@/lib/decisionEngine").DecisionAction;
  const urgencyStr = (decision?.urgency ?? "MEDIUM") as import("@/lib/decisionEngine").DecisionUrgency;
  const rr = levels ? (levels.target - levels.entry) / Math.max(levels.entry - levels.stop, 0.01) : 0;

  const similarSetups = useMemo(() => {
    const currentStrategy = String(decision?.execution_plan?.strategy || "").toUpperCase();
    return (opportunitiesQuery.data?.data || [])
      .filter((row) => String(row.symbol || "").toUpperCase() !== ticker)
      .filter((row) => currentStrategy && String(row.strategy || "").toUpperCase() === currentStrategy)
      .slice(0, 6);
  }, [opportunitiesQuery.data, decision?.execution_plan?.strategy, ticker]);

  const riskScore = toNum(decision?.tradeability?.tradeability_score, 0);
  const overviewRaw = overviewQuery.data as Record<string, unknown> | undefined;
  const whyText = generateResearchWhy(overviewRaw, decision, opportunityForTicker, price);
  const howText = generateResearchHow(decision, opportunityForTicker, actionStr);

  return (
    <div className="space-y-4 bg-[#0B0F14]">
      {/* Decision summary — always shown */}
      <section className="cockpit-card bg-[#121826] border-[#1F2937]">
        <div className="text-xs uppercase text-gray-400 mb-1">What Should I Do?</div>
        <div className="text-[11px] text-gray-600 mb-3">{ticker}</div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <DecisionBadge action={actionStr} urgency={urgencyStr} size="lg" />
          {confidence > 0 && <ConfidenceGauge value={confidence} size={86} />}
          {expectedMovePct !== 0 && (
            <div className="min-w-[220px]">
              <div className="text-[11px] text-gray-400 uppercase">Expected Move</div>
              <ExpectedMoveBar expectedMovePercent={expectedMovePct} changePercent={0} />
            </div>
          )}
        </div>
        {loading ? (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-800/60" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-800/40" />
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3 text-sm text-cyan-100 mb-2">
              <span className="text-[10px] uppercase tracking-widest text-cyan-500 block mb-1">Why</span>
              {whyText}
            </div>
            <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-3 text-sm text-slate-300">
              <span className="text-[10px] uppercase tracking-widest text-slate-500 block mb-1">How to trade</span>
              {howText}
            </div>
          </>
        )}
      </section>

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
              if (target) router.push(`/research-v2/${target}`);
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
            <div className="text-slate-300 text-sm mt-2">{whyText}</div>
            {decision?.why_moving?.catalyst_type && (
              <span className="mt-2 inline-block rounded bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[10px] text-blue-400">
                {decision.why_moving.catalyst_type}
              </span>
            )}
          </div>

          <div className="cockpit-card bg-[#121826] border-[#1F2937]">
            <div className="text-xs uppercase text-gray-400">Trade Plan</div>
            {decision?.execution_plan?.strategy && (
              <div className="text-slate-400 text-[11px] mt-1 mb-1 uppercase tracking-wide">{decision.execution_plan.strategy}</div>
            )}
            <div className="text-slate-300 text-sm mt-1">{howText}</div>
            {levels && (
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px] text-center">
                <div className="rounded-lg bg-slate-800/60 py-1.5">
                  <div className="text-slate-500">Entry</div>
                  <div className="text-slate-200 font-medium">${levels.entry.toFixed(2)}</div>
                </div>
                <div className="rounded-lg bg-rose-950/40 py-1.5">
                  <div className="text-slate-500">Stop</div>
                  <div className="text-rose-400 font-medium">${levels.stop.toFixed(2)}</div>
                </div>
                <div className="rounded-lg bg-emerald-950/40 py-1.5">
                  <div className="text-slate-500">Target</div>
                  <div className="text-emerald-400 font-medium">${levels.target.toFixed(2)}</div>
                </div>
              </div>
            )}
            {rr > 0 && <div className="mt-1 text-[10px] text-slate-600">R:R {rr.toFixed(2)}:1</div>}
          </div>

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
                      {/* external logos are intentionally raw img tags here to preserve the lightweight onError fallback */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
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

      {/* Premarket Intelligence Panel */}
      {(premarketIntel.premarket_signal_type || premarketIntel.premarket_trend) && (
        <section className="cockpit-card bg-[#121826] border-[#1F2937]">
          <div className="text-xs uppercase text-gray-400 mb-3">Premarket Intelligence</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-3">
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
              <div className="text-gray-400 text-xs">Trend</div>
              <div className={`text-sm font-semibold mt-1 ${premarketIntel.premarket_trend === "UP" ? "text-green-400" : premarketIntel.premarket_trend === "DOWN" ? "text-red-400" : "text-yellow-400"}`}>
                {premarketIntel.premarket_trend ?? "—"}
              </div>
            </div>
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
              <div className="text-gray-400 text-xs">Gap %</div>
              <div className={`text-sm font-semibold mt-1 ${(premarketIntel.premarket_gap ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                {premarketIntel.premarket_gap != null ? `${Number(premarketIntel.premarket_gap) >= 0 ? "+" : ""}${Number(premarketIntel.premarket_gap).toFixed(2)}%` : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
              <div className="text-gray-400 text-xs">Confidence</div>
              <div className={`text-sm font-semibold mt-1 ${premarketIntel.premarket_gap_confidence === "HIGH" ? "text-green-400" : premarketIntel.premarket_gap_confidence === "MEDIUM" ? "text-yellow-400" : "text-gray-400"}`}>
                {premarketIntel.premarket_gap_confidence ?? "—"}
              </div>
            </div>
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
              <div className="text-gray-400 text-xs">Signal</div>
              <div className={`text-xs font-semibold mt-1 ${premarketIntel.premarket_signal_type === "GAP_AND_GO" ? "text-green-400" : premarketIntel.premarket_signal_type === "GAP_FADE" ? "text-red-400" : premarketIntel.premarket_signal_type === "RANGE_BUILD" ? "text-yellow-400" : "text-gray-400"}`}>
                {premarketIntel.premarket_signal_type ?? "—"}
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 mb-3">
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
              <div className="text-gray-400 text-xs">Structure %</div>
              <div className="text-white text-sm font-semibold mt-1">
                {premarketIntel.premarket_range_percent != null ? `${Number(premarketIntel.premarket_range_percent).toFixed(2)}%` : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
              <div className="text-gray-400 text-xs">PM Volume</div>
              <div className="text-white text-sm font-semibold mt-1">
                {premarketIntel.premarket_volume != null ? Number(premarketIntel.premarket_volume).toLocaleString() : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
              <div className="text-gray-400 text-xs">Valid</div>
              <div className={`text-sm font-semibold mt-1 ${premarketIntel.premarket_valid ? "text-green-400" : "text-red-400"}`}>
                {premarketIntel.premarket_valid != null ? (premarketIntel.premarket_valid ? "YES" : "NO") : "—"}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-3 text-xs text-cyan-100">
            {premarketNarrative(premarketIntel)}
          </div>
        </section>
      )}

      {/* Execution Panel — shown when execution data is available */}
      {(premarketIntel.entry_price || premarketIntel.execution_type) && (() => {
        const verdict  = executionVerdict(premarketIntel);
        const failures = executionFailureReasons(premarketIntel);
        const verdictColor =
          verdict === "GOOD"  ? "text-green-400 border-green-400/30 bg-green-500/5"  :
          verdict === "WATCH" ? "text-yellow-400 border-yellow-400/30 bg-yellow-500/5" :
                                "text-red-400 border-red-400/30 bg-red-500/5";

        return (
          <section className="cockpit-card bg-[#121826] border-[#1F2937]">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase text-gray-400">Execution Plan</div>
              <div className={`rounded-lg border px-3 py-1 text-xs font-bold ${verdictColor}`}>
                {verdict === "GOOD" ? "GOOD SETUP" : verdict === "WATCH" ? "WATCH" : "AVOID"}
              </div>
            </div>

            {/* Price levels */}
            {premarketIntel.entry_price && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
                  <div className="text-gray-400 text-xs">Entry</div>
                  <div className="text-white font-semibold text-sm mt-1">${Number(premarketIntel.entry_price).toFixed(2)}</div>
                  <div className="text-gray-500 text-xs mt-0.5">{premarketIntel.execution_type ?? "—"}</div>
                </div>
                <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
                  <div className="text-gray-400 text-xs">Stop</div>
                  <div className="text-red-400 font-semibold text-sm mt-1">${Number(premarketIntel.stop_price ?? 0).toFixed(2)}</div>
                  <div className="text-gray-500 text-xs mt-0.5">Risk {Number(premarketIntel.risk_percent ?? 0).toFixed(2)}%</div>
                </div>
                <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
                  <div className="text-gray-400 text-xs">Target</div>
                  <div className="text-green-400 font-semibold text-sm mt-1">${Number(premarketIntel.target_price ?? 0).toFixed(2)}</div>
                  <div className="text-gray-500 text-xs mt-0.5">Reward {Number(premarketIntel.reward_percent ?? 0).toFixed(2)}%</div>
                </div>
              </div>
            )}

            {/* R:R + position size */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
                <div className="text-gray-400 text-xs">R:R Ratio</div>
                <div className={`font-semibold text-sm mt-1 ${(premarketIntel.risk_reward_ratio ?? 0) >= 2 ? "text-green-400" : (premarketIntel.risk_reward_ratio ?? 0) >= 1.5 ? "text-yellow-400" : "text-red-400"}`}>
                  {premarketIntel.risk_reward_ratio != null ? `${Number(premarketIntel.risk_reward_ratio).toFixed(2)}:1` : "—"}
                </div>
              </div>
              <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
                <div className="text-gray-400 text-xs">Position Size</div>
                <div className="text-white text-sm font-semibold mt-1">
                  {premarketIntel.position_size_shares != null ? `${Number(premarketIntel.position_size_shares).toFixed(0)} shares` : "—"}
                </div>
              </div>
              <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
                <div className="text-gray-400 text-xs">Position Value</div>
                <div className="text-white text-sm font-semibold mt-1">
                  {premarketIntel.position_size_value != null ? `£${Number(premarketIntel.position_size_value).toFixed(2)}` : "—"}
                </div>
              </div>
            </div>

            {/* Failure reasons (Phase 11) */}
            {failures.length > 0 && (
              <div className="rounded-xl border border-red-400/20 bg-red-500/5 p-3">
                <div className="text-red-400 text-xs font-semibold mb-1">Setup not tradeable:</div>
                <ul className="space-y-0.5">
                  {failures.map(r => (
                    <li key={r} className="text-red-300 text-xs">• {r}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })()}

      {/* Execution Confirmation Panel (Phase 12) */}
      {premarketIntel.execution_rating && (
        <section className="cockpit-card bg-[#121826] border-[#1F2937]">
          <div className="text-xs uppercase text-gray-400 mb-3">Execution Confirmation</div>
          <div className="grid gap-3 sm:grid-cols-4 mb-3">
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
              <div className="text-gray-400 text-xs">Session</div>
              <div className={`text-sm font-semibold mt-1 ${
                premarketIntel.session_phase === "OPEN"  ? "text-green-400"  :
                premarketIntel.session_phase === "CLOSE" ? "text-yellow-400" :
                premarketIntel.session_phase === "MIDDAY"? "text-blue-400"   :
                "text-gray-400"
              }`}>
                {premarketIntel.session_phase ?? "—"}
              </div>
            </div>
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
              <div className="text-gray-400 text-xs">Entry Confirmed</div>
              <div className={`text-sm font-semibold mt-1 ${premarketIntel.entry_confirmed ? "text-green-400" : "text-red-400"}`}>
                {premarketIntel.entry_confirmed != null ? (premarketIntel.entry_confirmed ? "YES" : "NO") : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
              <div className="text-gray-400 text-xs">Breakout Strength</div>
              <div className={`text-sm font-semibold mt-1 ${
                (premarketIntel.breakout_strength ?? 0) > 3 ? "text-green-400"  :
                (premarketIntel.breakout_strength ?? 0) > 1.5 ? "text-yellow-400" :
                "text-red-400"
              }`}>
                {premarketIntel.breakout_strength != null ? `${Number(premarketIntel.breakout_strength).toFixed(1)} / 5` : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F14] p-3">
              <div className="text-gray-400 text-xs">Execution Rating</div>
              <div className={`text-sm font-bold mt-1 ${
                premarketIntel.execution_rating === "ELITE" ? "text-green-400"  :
                premarketIntel.execution_rating === "GOOD"  ? "text-cyan-400"   :
                premarketIntel.execution_rating === "WATCH" ? "text-yellow-400" :
                "text-red-400"
              }`}>
                {premarketIntel.execution_rating ?? "—"}
              </div>
            </div>
          </div>
          {premarketIntel.execution_notes && (
            <div className={`rounded-xl border p-3 text-xs ${
              premarketIntel.execution_rating === "ELITE" ? "border-green-400/20 bg-green-500/5 text-green-100"  :
              premarketIntel.execution_rating === "GOOD"  ? "border-cyan-400/20  bg-cyan-500/5  text-cyan-100"   :
              premarketIntel.execution_rating === "WATCH" ? "border-yellow-400/20 bg-yellow-500/5 text-yellow-100":
                                                            "border-red-400/20   bg-red-500/5   text-red-100"
            }`}>
              {premarketIntel.execution_notes}
            </div>
          )}
        </section>
      )}

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
