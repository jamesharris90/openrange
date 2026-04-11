"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";
import { QUERY_POLICY } from "@/lib/queries/policy";
import { useTickerStore } from "@/lib/store/ticker-store";
import { getDecision } from "@/lib/decisionEngine";
import { toNum, tradeabilityCheck } from "@/lib/cockpit/rules";
import { ConfidenceGauge, DecisionBadge, ExpectedMoveBar, SymbolLogo, UrgencyPulse } from "@/components/terminal/metric-visuals";

type Opportunity = {
  symbol?: string;
  strategy?: string;
  confidence?: number;
  expected_move_percent?: number;
  why_moving?: string;
  how_to_trade?: string;
  change_percent?: number;
  relative_volume?: number;
  updated_at?: string;
  created_at?: string;
};

type Quote = {
  symbol?: string;
  price?: number;
  change_percent?: number;
  volume?: number;
  updated_at?: string;
};

// ─── Fallback narrative generators ────────────────────────────────────────────

function generateWhy(row: Opportunity, quote: Quote | undefined): { text: string; fallback: boolean } {
  const raw = String(row.why_moving || "").trim();
  if (raw.length > 8) return { text: raw, fallback: false };

  const chg = toNum(quote?.change_percent ?? row.change_percent, 0);
  const rvol = toNum(row.relative_volume, 0);
  const dir = chg > 0 ? "up" : "down";
  const chgFmt = Math.abs(chg).toFixed(1);

  if (Math.abs(chg) > 5 && rvol > 2)
    return { text: `Moving ${dir} ${chgFmt}% on ${rvol.toFixed(1)}x relative volume — institutional momentum.`, fallback: true };
  if (Math.abs(chg) > 3)
    return { text: `Significant ${dir} move of ${chgFmt}% with above-average participation.`, fallback: true };
  if (rvol > 2)
    return { text: `Volume running ${rvol.toFixed(1)}x normal — unusual activity, watch for catalyst follow-through.`, fallback: true };
  if (Math.abs(chg) > 1)
    return { text: `Directional pressure ${dir} ${chgFmt}% — tracking for setup confirmation.`, fallback: true };
  return { text: `Under surveillance — watching for catalysts to establish direction.`, fallback: true };
}

function generateHow(row: Opportunity, quote: Quote | undefined): { text: string; fallback: boolean } {
  const raw = String(row.how_to_trade || "").trim();
  if (raw.length > 8) return { text: raw, fallback: false };

  const strat = String(row.strategy || "").toLowerCase();
  const chg = toNum(quote?.change_percent ?? row.change_percent, 0);

  if (strat.includes("gap"))
    return { text: `Gap setup — wait for first 15m consolidation, enter break of premarket high, stop below premarket low.`, fallback: true };
  if (strat.includes("breakout"))
    return { text: `Breakout — wait for volume confirmation above key level before committing. Stop below breakout origin.`, fallback: true };
  if (strat.includes("short") || chg < -3)
    return { text: `Short bias — enter on failed bounce rejection with stop above descending resistance.`, fallback: true };
  if (chg > 3)
    return { text: `Long bias — enter on VWAP reclaim or first pullback after open. Stop below session low.`, fallback: true };
  return { text: `Wait for first 15m range to form, then trade the break with volume confirmation.`, fallback: true };
}

// ─── Sparkline ─────────────────────────────────────────────────────────────────

function sparklinePath(points: number[]) {
  if (!points.length) return "";
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * 100;
      const y = 100 - ((point - min) / span) * 100;
      return `${x},${y}`;
    })
    .join(" ");
}

type SortMode = "confidence" | "volume" | "move" | "recency";

type ContextState = {
  symbol: string;
  x: number;
  y: number;
};

// ─── Tier badge ─────────────────────────────────────────────────────────────────

function TierBadge({ confidence, hasFallback }: { confidence: number; hasFallback: boolean }) {
  if (hasFallback) {
    return <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[9px] uppercase text-slate-500 tracking-wider">Est</span>;
  }
  if (confidence >= 75) {
    return <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] uppercase text-emerald-400 tracking-wider">Signal</span>;
  }
  if (confidence >= 55) {
    return <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] uppercase text-amber-400 tracking-wider">Watch</span>;
  }
  return <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[9px] uppercase text-slate-500 tracking-wider">Low</span>;
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function StocksInPlayView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const addWatch = useTickerStore((state) => state.addWatch);
  const [sortBy, setSortBy] = useState<SortMode>("confidence");
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const opportunitiesQuery = useQuery({
    queryKey: ["cockpit", "sip", "opportunities"],
    queryFn: () => apiGet<{ data?: Opportunity[] }>("/api/intelligence/top-opportunities?limit=200"),
    ...QUERY_POLICY.fast,
  });

  const symbols = useMemo(() => {
    const rows = Array.isArray(opportunitiesQuery.data?.data) ? opportunitiesQuery.data.data : [];
    return rows.map((row) => String(row.symbol || "").toUpperCase()).filter(Boolean).slice(0, 100);
  }, [opportunitiesQuery.data]);

  const quotesQuery = useQuery({
    queryKey: ["cockpit", "sip", "quotes", symbols.join(",")],
    queryFn: () => {
      if (symbols.length === 0) return Promise.resolve({ data: [] as Quote[] });
      return apiGet<{ data?: Quote[] }>(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
    },
    enabled: symbols.length > 0,
    ...QUERY_POLICY.fast,
  });

  const quoteMap = useMemo(() => {
    const rows = Array.isArray(quotesQuery.data?.data) ? quotesQuery.data.data : [];
    return new Map(rows.map((row) => [String(row.symbol || "").toUpperCase(), row]));
  }, [quotesQuery.data]);

  const classified = useMemo(() => {
    const rows = Array.isArray(opportunitiesQuery.data?.data) ? opportunitiesQuery.data.data : [];
    return rows.map((row) => {
      const symbol = String(row.symbol || "").toUpperCase();
      const quote = quoteMap.get(symbol);
      const check = tradeabilityCheck({
        timestamp: quote?.updated_at || row.updated_at || row.created_at,
        changePercent: quote?.change_percent ?? row.change_percent,
        volume: quote?.volume,
        relativeVolume: row.relative_volume,
        catalyst: row.why_moving,
      });
      const why = generateWhy(row, quote);
      const how = generateHow(row, quote);
      return {
        ...row,
        symbol,
        sector: String((row as unknown as { sector?: string }).sector || "").toUpperCase(),
        quote,
        check,
        why,
        how,
        hasFallback: why.fallback || how.fallback,
      };
    });
  }, [opportunitiesQuery.data, quoteMap]);

  const selectedSector = String(searchParams.get("sector") || "").trim().toUpperCase();

  // Include everything that has a symbol + any usable data — no hard block on WHY/HOW
  const visible = useMemo(() => {
    const filtered = classified.filter((row) => {
      if (!row.symbol) return false;
      if (row.check.status === "STALE") return false;
      if (selectedSector && row.sector && !row.sector.includes(selectedSector)) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortBy === "volume") return toNum(b.relative_volume, 0) - toNum(a.relative_volume, 0);
      if (sortBy === "move") return Math.abs(toNum(b.expected_move_percent, 0)) - Math.abs(toNum(a.expected_move_percent, 0));
      if (sortBy === "recency") {
        const aTime = Date.parse(String(a.quote?.updated_at || a.updated_at || a.created_at || 0));
        const bTime = Date.parse(String(b.quote?.updated_at || b.updated_at || b.created_at || 0));
        return bTime - aTime;
      }
      // Default: confidence — prime signals first, then fallback signals
      const confDiff = toNum(b.confidence, 0) - toNum(a.confidence, 0);
      if (!a.hasFallback && b.hasFallback) return -1;
      if (a.hasFallback && !b.hasFallback) return 1;
      return confDiff;
    });
  }, [classified, sortBy, selectedSector]);

  const staleRemoved = classified.filter((row) => row.check.status === "STALE").length;
  const signalCount = visible.filter((r) => !r.hasFallback).length;

  if (opportunitiesQuery.isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-56 rounded-2xl bg-slate-900 animate-pulse" />
        ))}
      </div>
    );
  }

  // Graceful empty state — never show a red error block
  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/40 py-16 text-center">
        <div className="text-2xl font-black text-slate-600 mb-2">No active setups</div>
        <div className="text-sm text-slate-500 max-w-sm">
          {opportunitiesQuery.isError
            ? "Could not reach the backend — check your connection and try again."
            : "The scanner found no signals meeting minimum criteria. This typically resolves within the first 30 minutes of market open."}
        </div>
        <Link href="/screener-v2" className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition">
          Open Screener →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Header / Controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <div>
            <span className="text-sm font-semibold text-slate-100">{visible.length} in play</span>
            {signalCount > 0 && (
              <span className="ml-2 text-[11px] text-emerald-400">{signalCount} with live signal</span>
            )}
            {staleRemoved > 0 && (
              <span className="ml-2 text-[11px] text-slate-600">{staleRemoved} stale removed</span>
            )}
          </div>
          {selectedSector && (
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-400">
              {selectedSector}
            </span>
          )}
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1 text-[11px]">
          {(["confidence", "volume", "move", "recency"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSortBy(mode)}
              className={`rounded px-2.5 py-1 uppercase tracking-wide transition ${sortBy === mode ? "bg-slate-700 text-slate-100 shadow" : "text-slate-500 hover:text-slate-300"}`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* ── Cards grid ── */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((row) => {
          const confidence = toNum(row.confidence, 0);
          const movePct = toNum(row.expected_move_percent, 0);
          const changePct = toNum(row.quote?.change_percent ?? row.change_percent, 0);
          const price = toNum(row.quote?.price, Number.NaN);
          const decision = getDecision({
            confidence,
            relative_volume: row.relative_volume,
            volume: row.quote?.volume,
            market_session: (row as unknown as { market_session?: string }).market_session,
          });
          const spark = [changePct * 0.2, changePct * 0.5, changePct, movePct * 0.4, movePct];
          const path = sparklinePath(spark);
          const symbol = row.symbol;

          return (
            <Link
              key={`${symbol}-${String(row.strategy || "")}-${String(row.quote?.updated_at || row.updated_at || row.created_at || "")}`}
              href={`/research-v2/${symbol}`}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ symbol, x: event.clientX, y: event.clientY });
              }}
              className="group rounded-2xl border border-slate-800 bg-slate-900/50 p-4 transition hover:scale-[1.02] hover:shadow-xl hover:border-slate-700"
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <SymbolLogo symbol={symbol} />
                  <div className="font-semibold text-slate-100">{symbol}</div>
                  <TierBadge confidence={confidence} hasFallback={row.hasFallback} />
                </div>
                <UrgencyPulse relativeVolume={row.relative_volume} changePercent={changePct} />
              </div>

              {/* Price + confidence */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  {String(row.strategy || "") && (
                    <div className="text-[11px] text-slate-500 uppercase mb-0.5">{String(row.strategy || "")}</div>
                  )}
                  <div className="text-slate-100 text-sm font-medium">
                    {Number.isFinite(price) ? `$${price.toFixed(2)}` : "—"}
                  </div>
                  <div className={changePct > 0 ? "text-emerald-400 text-xs" : changePct < 0 ? "text-rose-400 text-xs" : "text-slate-500 text-xs"}>
                    {changePct > 0 ? "+" : ""}{changePct.toFixed(2)}%
                  </div>
                </div>
                <ConfidenceGauge value={confidence} size={90} />
              </div>

              {/* Decision badge */}
              <div className="mb-2">
                <DecisionBadge action={decision.action} urgency={decision.urgency} size="lg" />
              </div>

              {/* Sparkline */}
              <svg viewBox="0 0 100 24" className="w-full h-6 mb-2">
                <polyline
                  fill="none"
                  stroke={changePct >= 0 ? "#4ade80" : "#f87171"}
                  strokeWidth="2"
                  points={path}
                />
              </svg>

              {/* Expected move bar */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2 mb-2">
                <div className="text-[10px] uppercase text-slate-500 mb-1">Expected Move</div>
                <ExpectedMoveBar expectedMovePercent={movePct} changePercent={changePct} />
              </div>

              {/* Decision reason + volume */}
              <div className="grid grid-cols-2 gap-2 text-[11px] mb-2">
                <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-cyan-300">{decision.reason}</div>
                <div className="rounded-lg border border-slate-800 px-2 py-1 text-slate-500">RVOL {toNum(row.relative_volume, 0).toFixed(2)}</div>
              </div>

              {/* WHY / HOW */}
              <div className="text-slate-200 text-xs line-clamp-2 leading-snug">
                <span className={row.why.fallback ? "text-slate-500" : "text-slate-400"}>WHY</span>{" "}
                {row.why.text}
              </div>
              <div className="mt-1 text-xs line-clamp-2 leading-snug">
                <span className={row.how.fallback ? "text-slate-500" : "text-cyan-500"}>HOW</span>{" "}
                <span className={row.how.fallback ? "text-slate-500" : "text-cyan-300"}>{row.how.text}</span>
              </div>

              {/* Hover: execution plan */}
              <div className="mt-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 text-[11px] text-slate-500 space-y-1">
                <div>Entry: {String((row as unknown as { execution_plan?: { entry?: string } }).execution_plan?.entry || "At trigger")} </div>
                <div>Stop: {String((row as unknown as { execution_plan?: { stop?: string } }).execution_plan?.stop || "Below key level")}</div>
                <div>Target: {String((row as unknown as { execution_plan?: { target?: string } }).execution_plan?.target || "Primary resistance")}</div>
                {(row.quote?.updated_at || row.updated_at || row.created_at) && (
                  <div>Updated {new Date(String(row.quote?.updated_at || row.updated_at || row.created_at)).toLocaleTimeString()}</div>
                )}
              </div>
            </Link>
          );
        })}
      </section>

      {/* ── Context menu ── */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[170px] rounded-lg border border-slate-800 bg-slate-900 p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="w-full rounded px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800" onClick={() => router.push(`/research-v2/${contextMenu.symbol}`)}>Open in Research</button>
          <button type="button" className="w-full rounded px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800" onClick={() => router.push(`/alerts?ticker=${contextMenu.symbol}`)}>Add Alert</button>
          <button type="button" className="w-full rounded px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800" onClick={() => addWatch(contextMenu.symbol)}>Add to Watchlist</button>
        </div>
      )}
    </div>
  );
}
