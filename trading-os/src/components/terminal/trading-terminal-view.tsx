"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ChartEngine } from "@/components/charts/chart-engine";
import { ConfidenceRadialGauge, ExpectedMoveBar, SymbolLogo, UrgencyPulse } from "@/components/terminal/metric-visuals";
import { apiGet } from "@/lib/api/client";
import { QUERY_POLICY } from "@/lib/queries/policy";
import { useTickerStore } from "@/lib/store/ticker-store";
import { getDecision } from "@/lib/decisionEngine";
import { toNum } from "@/lib/cockpit/rules";
import { safeFixed } from "@/utils/safeNumber";
import { getPlaybookTier, playbookLabel, calcPositionSize, TIER_STYLE } from "@/lib/playbook";
import { getCachedMarketMode } from "@/lib/marketMode";

type Opportunity = {
  symbol?: string;
  strategy?: string;
  confidence?: number;
  expected_move_percent?: number;
  why_moving?: string;
  how_to_trade?: string;
  execution_plan?: { entry?: string; stop?: string; target?: string };
  trade_class?: string;
  relative_volume?: number;
  change_percent?: number;
  updated_at?: string;
  created_at?: string;
};

type Watchlist = {
  symbol?: string;
  watch_reason?: string;
  watch_priority?: number;
};

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T[];
  status?: "ok" | "fallback" | string;
  error?: string | null;
};

type SortMode = "confidence" | "volume" | "move" | "recency";

type ContextState = {
  symbol: string;
  x: number;
  y: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function sparklinePath(value: number) {
  const points = [value * 0.2, value * 0.6, value * 0.35, value * 0.8, value];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  return points
    .map((point, index) => {
      const x = (index / 4) * 100;
      const y = 100 - ((point - min) / span) * 100;
      return `${x},${y}`;
    })
    .join(" ");
}

export function TradingTerminalView() {
  const router = useRouter();
  const addWatch = useTickerStore((state) => state.addWatch);
  const [chartGrid, setChartGrid] = useState<2 | 3 | 6>(3);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortMode>("confidence");
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null);
  const [lastHotkey, setLastHotkey] = useState<string>("");

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toUpperCase();
      if (key === "B") setLastHotkey("Marked for review");
      if (key === "A") setLastHotkey("Alert intent captured");
      if (key === "N") setLastHotkey("Ignored for now");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const opportunitiesQuery = useQuery({
    queryKey: ["cockpit", "terminal", "opportunities"],
    queryFn: () => apiGet<{ data?: Opportunity[] }>("/api/trading-terminal?limit=200"),
    ...QUERY_POLICY.fast,
  });

  const watchlistQuery = useQuery({
    queryKey: ["cockpit", "terminal", "watchlist"],
    queryFn: () => apiGet<{ data?: Watchlist[] }>("/api/intelligence/watchlist?limit=100"),
    ...QUERY_POLICY.fast,
  });

  const signalsQuery = useQuery({
    queryKey: ["cockpit", "terminal", "signals"],
    queryFn: () => apiGet<ApiEnvelope<Record<string, unknown>>>("/api/signals?limit=500"),
    ...QUERY_POLICY.fast,
  });

  const catalystsQuery = useQuery({
    queryKey: ["cockpit", "terminal", "catalysts"],
    queryFn: () => apiGet<ApiEnvelope<Record<string, unknown>>>("/api/catalysts?limit=200"),
    ...QUERY_POLICY.fast,
  });

  const macroQuery = useQuery({
    queryKey: ["cockpit", "terminal", "macro"],
    queryFn: () => apiGet<ApiEnvelope<Record<string, unknown>>>("/api/macro?limit=20"),
    ...QUERY_POLICY.fast,
  });

  const rawOpportunities = (Array.isArray(opportunitiesQuery.data?.data) ? opportunitiesQuery.data.data : []).filter(
    (row): row is Opportunity => isRecord(row)
  );
  const opportunities = rawOpportunities.filter((row) => {
    const hasWhy = String(row.why_moving || "").trim().length > 0;
    const hasHow = String(row.how_to_trade || "").trim().length > 0;
    const tradeClass = String(row.trade_class || "TRADEABLE").toUpperCase();
    return hasWhy && hasHow && tradeClass === "TRADEABLE";
  });
  const watchlist = (Array.isArray(watchlistQuery.data?.data) ? watchlistQuery.data.data : []).filter(
    (row): row is Watchlist => isRecord(row)
  );

  const hasPartialData = signalsQuery.data?.status === "fallback"
    || catalystsQuery.data?.status === "fallback"
    || macroQuery.data?.status === "fallback";

  const watchRows = useMemo(() => {
    const fromWatch = watchlist.map((row) => {
      const symbol = String(row.symbol || "").toUpperCase();
      const linked = opportunities.find((op) => String(op.symbol || "").toUpperCase() === symbol);
      return {
        symbol,
        confidence: toNum(linked?.confidence, 0),
        relativeVolume: toNum(linked?.relative_volume, 0),
        expectedMove: toNum(linked?.expected_move_percent, 0),
        changePercent: toNum(linked?.change_percent, 0),
        updatedAt: String(linked?.updated_at || linked?.created_at || ""),
        reason: String(row.watch_reason || linked?.why_moving || ""),
      };
    });

    if (fromWatch.length > 0) return fromWatch;

    return opportunities.slice(0, 20).map((row) => ({
      symbol: String(row.symbol || "").toUpperCase(),
      confidence: toNum(row.confidence, 0),
      relativeVolume: toNum(row.relative_volume, 0),
      expectedMove: toNum(row.expected_move_percent, 0),
      changePercent: toNum(row.change_percent, 0),
      updatedAt: String(row.updated_at || row.created_at || ""),
      reason: String(row.why_moving || ""),
    }));
  }, [watchlist, opportunities]);

  const sortedWatchRows = useMemo(() => {
    const rows = [...watchRows];
    rows.sort((a, b) => {
      if (sortBy === "volume") return b.relativeVolume - a.relativeVolume;
      if (sortBy === "move") return Math.abs(b.expectedMove) - Math.abs(a.expectedMove);
      if (sortBy === "recency") return Date.parse(b.updatedAt || "0") - Date.parse(a.updatedAt || "0");
      return b.confidence - a.confidence;
    });
    return rows;
  }, [watchRows, sortBy]);

  const chartSymbols = useMemo(() => {
    const base = sortedWatchRows.map((row) => row.symbol).filter(Boolean);
    const fallback = opportunities.map((row) => String(row.symbol || "").toUpperCase()).filter(Boolean);
    const unique = Array.from(new Set([...base, ...fallback]));
    return unique.slice(0, chartGrid);
  }, [sortedWatchRows, opportunities, chartGrid]);

  useEffect(() => {
    if (!selectedSymbol && chartSymbols.length > 0) {
      setSelectedSymbol(chartSymbols[0]);
    }
  }, [selectedSymbol, chartSymbols]);

  const selectedOpportunity = opportunities.find((row) => String(row.symbol || "").toUpperCase() === selectedSymbol)
    || opportunities[0]
    || null;
  const decision = getDecision({
    confidence: selectedOpportunity?.confidence,
    relative_volume: selectedOpportunity?.relative_volume,
    market_session: "EARLY",
  });

  const modeInfo = getCachedMarketMode();
  const isLoading = opportunitiesQuery.isLoading || watchlistQuery.isLoading || signalsQuery.isLoading || catalystsQuery.isLoading || macroQuery.isLoading;

  if (isLoading) {
    return <div className="cockpit-card text-[var(--muted-foreground)]">Loading trading cockpit...</div>;
  }

  const streamIncomplete = rawOpportunities.length > 0 && opportunities.length === 0;
  const noOpportunities  = rawOpportunities.length === 0;
  const chartFeedIncomplete = chartSymbols.length === 0 || !selectedOpportunity;

  if (streamIncomplete) {
    console.error("[trading-terminal] opportunity decision flow incomplete", { raw: rawOpportunities.length });
  }
  if (noOpportunities) {
    console.warn(`[trading-terminal] no opportunities (mode=${modeInfo.mode})`);
  }
  if (chartFeedIncomplete) {
    console.warn("[trading-terminal] chart symbols unavailable", {
      chartSymbols: chartSymbols.length,
      hasSelectedOpportunity: Boolean(selectedOpportunity),
    });
  }

  return (
    <div className="space-y-4">
      {streamIncomplete ? (
        <div className="cockpit-card">
          <div className="text-amber-400 text-sm font-semibold">Opportunity stream filtering active</div>
          <div className="text-[var(--muted-foreground)] text-xs mt-1">Some rows missing WHY/HOW fields — displaying verified signals only.</div>
        </div>
      ) : null}

      {noOpportunities ? (
        <div className="cockpit-card border border-slate-700 bg-slate-900/60 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-widest
              ${modeInfo.mode === "LIVE" ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
              : modeInfo.mode === "RECENT" ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
              : "text-slate-400 border-slate-600 bg-slate-800/40"}`}>
              {modeInfo.mode}
            </span>
            <span className="text-slate-300 text-sm font-semibold">
              {modeInfo.mode === "PREP"
                ? "PREP MODE — building watchlist for next open"
                : modeInfo.mode === "RECENT"
                ? "After-hours — showing recent session signals"
                : "No live opportunities available"}
            </span>
          </div>
          <div className="text-[var(--muted-foreground)] text-xs">{modeInfo.reason} · Terminal will populate when signals arrive.</div>
        </div>
      ) : null}

      {chartFeedIncomplete && !noOpportunities ? (
        <div className="cockpit-card">
          <div className="text-slate-400 text-sm">Chart feed initialising...</div>
          <div className="text-[var(--muted-foreground)] text-xs mt-1">Waiting for opportunity selection.</div>
        </div>
      ) : null}

      {hasPartialData ? (
        <div className="cockpit-card text-yellow-400 text-sm">Partial Data</div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[2fr_6fr_3fr]">
        <aside className="cockpit-card">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs uppercase text-[var(--muted-foreground)]">Watchlist</div>
            <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-1 text-[11px]">
              {(["confidence", "volume", "move", "recency"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSortBy(mode)}
                  className={`rounded px-2 py-1 uppercase tracking-wide ${sortBy === mode ? "bg-[var(--panel)] text-[var(--foreground)] shadow" : "text-[var(--muted-foreground)]"}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 max-h-[720px] overflow-y-auto pr-1">
            {sortedWatchRows.map((row) => (
              <button
                key={row.symbol}
                onClick={() => setSelectedSymbol(row.symbol)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ symbol: row.symbol, x: event.clientX, y: event.clientY });
                }}
                className={`group w-full text-left rounded-xl border p-2 transition ${selectedSymbol === row.symbol ? "border-white/40 bg-[var(--background)]" : "border-[var(--border)] bg-[var(--background)]"} hover:scale-[1.02] hover:shadow-xl`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SymbolLogo symbol={row.symbol} />
                    <span className="text-[var(--foreground)] text-sm font-semibold">{row.symbol}</span>
                  </div>
                  <UrgencyPulse relativeVolume={row.relativeVolume} changePercent={row.changePercent} />
                </div>
                <svg viewBox="0 0 100 24" className="w-full h-6 mt-2">
                  <polyline fill="none" stroke="#4ade80" strokeWidth="2" points={sparklinePath(row.confidence)} />
                </svg>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <ExpectedMoveBar expectedMovePercent={row.expectedMove} changePercent={row.changePercent} />
                  <ConfidenceRadialGauge value={row.confidence} size={74} />
                </div>
                <div className="mt-2 text-[10px] text-cyan-300 uppercase">{getDecision({ confidence: row.confidence, relative_volume: row.relativeVolume, market_session: "EARLY" }).action}</div>
                <div className="text-[var(--muted-foreground)] text-[11px] line-clamp-1 mt-1">{row.reason}</div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-cyan-300 mt-1">Click for charts and execution panel</div>
              </button>
            ))}
            {sortedWatchRows.length === 0 ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-xs text-[var(--muted-foreground)]">
                Awaiting live trade candidates. Stream remains active and will populate automatically.
              </div>
            ) : null}
          </div>
        </aside>

        <main className="cockpit-card">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase text-[var(--muted-foreground)]">Multi-Chart</div>
            <div className="flex items-center gap-2">
              {[2, 3, 6].map((count) => (
                <button
                  key={count}
                  onClick={() => setChartGrid(count as 2 | 3 | 6)}
                  className={`rounded-lg border px-2 py-1 text-xs ${chartGrid === count ? "border-white/40 text-[var(--foreground)]" : "border-[var(--border)] text-[var(--muted-foreground)]"}`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <div className={`grid gap-3 ${chartGrid === 2 ? "md:grid-cols-2" : chartGrid === 3 ? "md:grid-cols-3" : "md:grid-cols-3"}`}>
            {chartSymbols.map((symbol) => (
              <button key={symbol} onClick={() => setSelectedSymbol(symbol)} className="text-left">
                <ChartEngine ticker={symbol} timeframe="daily" syncCrosshairId="terminal-grid" />
              </button>
            ))}
          </div>
        </main>

        <aside className="cockpit-card space-y-2">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs uppercase tracking-widest text-[var(--muted-foreground)]">AI Trade Call</div>
            {selectedOpportunity?.symbol && (
              <span className="text-xs font-bold text-slate-300 font-mono">{selectedOpportunity.symbol}</span>
            )}
          </div>

          {/* EXECUTION BIAS — large, colour-coded */}
          {(() => {
            const action = decision.action;
            const chgDir = (selectedOpportunity?.change_percent ?? 0) >= 0;
            const execBias =
              action === "ENTER" ? (chgDir ? "LONG"  : "SHORT") :
              action === "AVOID" ? "WAIT" :
              action === "WATCH" ? "WATCH" :
                                   "WAIT";
            const biasCls =
              execBias === "LONG"  ? "text-emerald-400 border-emerald-500/30 bg-emerald-950/50" :
              execBias === "SHORT" ? "text-rose-400 border-rose-500/30 bg-rose-950/50" :
              execBias === "WATCH" ? "text-amber-400 border-amber-500/30 bg-amber-950/50" :
                                     "text-slate-400 border-slate-700 bg-slate-900/50";
            return (
              <div className={`rounded-xl border px-4 py-3 ${biasCls}`}>
                <div className="text-[10px] uppercase tracking-widest opacity-60 mb-0.5">Execution Bias</div>
                <div className="text-2xl font-black tracking-wide">{execBias}</div>
              </div>
            );
          })()}

          {/* PLAYBOOK DECISION — large */}
          {(() => {
            const conf   = typeof selectedOpportunity?.confidence === "number"
              ? selectedOpportunity.confidence : 0;
            const rvol   = typeof selectedOpportunity?.relative_volume === "number"
              ? selectedOpportunity.relative_volume : 0;
            const cls    = String(selectedOpportunity?.trade_class ?? "").toUpperCase();
            const q_conf = conf * 0.40;
            const q_rvol = Math.min(100, rvol / 3 * 100) * 0.20;
            const q_regime = (conf >= 80 ? 80 : 50) * 0.20;
            const q_cls  = (cls === "A" ? 90 : cls === "B" ? 65 : 30) * 0.20;
            const score  = Math.round(q_conf + q_rvol + q_regime + q_cls);
            const tier   = getPlaybookTier(score, conf, conf >= 75);
            const ts     = TIER_STYLE[tier];
            return (
              <div className={`rounded-xl border px-4 py-3 ${ts.badge}`}>
                <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">Playbook Decision</div>
                <div className={`text-xl font-black tracking-wide ${ts.text}`}>{tier}</div>
                <div className={`text-xs mt-0.5 font-semibold ${ts.text} opacity-80`}>
                  {playbookLabel(tier)}
                </div>
              </div>
            );
          })()}

          {/* Decision chip */}
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/40 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Decision</div>
            <div className="mt-1 text-base font-black text-cyan-300 tracking-wide">{decision.action}</div>
            {decision.reason && <div className="mt-0.5 text-[11px] text-slate-400 leading-relaxed">{decision.reason}</div>}
          </div>

          {/* Confidence bar */}
          {selectedOpportunity?.confidence != null && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Confidence</div>
                <span className={`text-sm font-black font-mono tabular-nums ${
                  selectedOpportunity.confidence >= 70 ? "text-emerald-400"
                  : selectedOpportunity.confidence >= 50 ? "text-amber-400"
                  : "text-slate-400"
                }`}>{safeFixed(selectedOpportunity.confidence, 0, "0")}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-800">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    selectedOpportunity.confidence >= 70 ? "bg-emerald-500"
                    : selectedOpportunity.confidence >= 50 ? "bg-amber-500"
                    : "bg-slate-600"
                  }`}
                  style={{ width: `${Math.min(100, selectedOpportunity.confidence)}%` }}
                />
              </div>
            </div>
          )}

          {/* Why */}
          {selectedOpportunity?.why_moving && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Why Moving</div>
              <div className="text-xs text-slate-300 leading-relaxed">{String(selectedOpportunity.why_moving)}</div>
            </div>
          )}

          {/* Trade plan */}
          {selectedOpportunity?.how_to_trade && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Trade Plan</div>
              <div className="text-xs text-slate-300 leading-relaxed">{String(selectedOpportunity.how_to_trade)}</div>
            </div>
          )}

          {/* Execution levels */}
          {(selectedOpportunity?.execution_plan?.entry || selectedOpportunity?.execution_plan?.stop || selectedOpportunity?.execution_plan?.target) && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Execution</div>
              <div className="space-y-1.5 text-xs font-mono">
                {selectedOpportunity.execution_plan?.entry && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Entry</span>
                    <span className="text-slate-200">{String(selectedOpportunity.execution_plan.entry)}</span>
                  </div>
                )}
                {selectedOpportunity.execution_plan?.stop && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Stop</span>
                    <span className="text-rose-400">{String(selectedOpportunity.execution_plan.stop)}</span>
                  </div>
                )}
                {selectedOpportunity.execution_plan?.target && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Target</span>
                    <span className="text-emerald-400">{String(selectedOpportunity.execution_plan.target)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Position size */}
          {(() => {
            const entry = parseFloat(String(selectedOpportunity?.execution_plan?.entry ?? ""));
            const stop  = parseFloat(String(selectedOpportunity?.execution_plan?.stop  ?? ""));
            const pos   = calcPositionSize(
              Number.isFinite(entry) ? entry : null,
              Number.isFinite(stop)  ? stop  : null,
            );
            if (!pos) return null;
            return (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Position Size (£10 risk)</div>
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300">{pos.shares} shares</span>
                  <span className="text-slate-500">${pos.positionValue.toLocaleString()} exposure</span>
                </div>
                <div className="text-[10px] text-slate-600 mt-0.5">
                  £{pos.riskPerShare.toFixed(2)}/share risk
                </div>
              </div>
            );
          })()}

          <div className="rounded-xl border border-slate-800 px-3 py-2 text-[10px] text-slate-600">
            Hotkeys: B mark · A alert · N ignore
          </div>
          {lastHotkey ? <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-2 text-xs text-cyan-100">{lastHotkey}</div> : null}
        </aside>
      </section>

      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[170px] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="w-full rounded px-3 py-2 text-left text-xs hover:bg-[var(--muted)]" onClick={() => router.push(`/stocks/${contextMenu.symbol}`)}>Open Stock Page</button>
          <button type="button" className="w-full rounded px-3 py-2 text-left text-xs hover:bg-[var(--muted)]" onClick={() => router.push(`/alerts?ticker=${contextMenu.symbol}`)}>Add Alert</button>
          <button type="button" className="w-full rounded px-3 py-2 text-left text-xs hover:bg-[var(--muted)]" onClick={() => addWatch(contextMenu.symbol)}>Add to Watchlist</button>
        </div>
      ) : null}
    </div>
  );
}
