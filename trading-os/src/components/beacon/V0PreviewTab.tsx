"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { apiFetch } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BEACON_QUERY_OPTIONS,
  fetchBeaconMarketContext,
  fetchV0Picks,
  type BeaconMarketContextResponse,
  type V0FilterParams,
  type V0Pick,
} from "@/components/beacon/beacon-api";

interface SignalEvidence {
  signal?: string;
  category?: string | null;
  rank?: number | null;
  reasoning?: string | null;
}

type FilterState = {
  date: string;
  tier: string;
  minPrice: string;
  maxPrice: string;
  minMarketCap: string;
  maxMarketCap: string;
  minRvol: string;
  minGap: string;
  direction: string;
  catalyst: string;
  topScope: string;
  limit: string;
};

const DEFAULT_FILTERS: FilterState = {
  date: "",
  tier: "",
  minPrice: "",
  maxPrice: "",
  minMarketCap: "",
  maxMarketCap: "",
  minRvol: "",
  minGap: "",
  direction: "",
  catalyst: "",
  topScope: "all",
  limit: "30",
};

const FORWARD_LOOKING_SIGNALS = new Set([
  "earnings_upcoming_within_3d",
  "top_coiled_spring",
  "top_volume_building",
]);

const INPUT_CLASS = "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400";

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC";
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  return `$${value.toFixed(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAlignmentCount(pick: V0Pick): number {
  const alignment = isRecord(pick.metadata.alignment) ? pick.metadata.alignment : null;
  const count = alignment?.alignmentCount;
  return typeof count === "number" ? count : pick.signals_aligned.length;
}

function getAlignmentBadgeClass(count: number): string {
  if (count >= 4) {
    return "border-emerald-300/70 bg-emerald-500/25 text-emerald-100 shadow-[0_0_24px_rgba(16,185,129,0.24)]";
  }
  if (count === 3) {
    return "border-blue-300/70 bg-blue-500/25 text-blue-100 shadow-[0_0_24px_rgba(59,130,246,0.22)]";
  }
  return "border-slate-600/60 bg-slate-800/70 text-slate-200";
}

function isForwardLookingSignal(signal: string | null | undefined): boolean {
  return typeof signal === "string" && FORWARD_LOOKING_SIGNALS.has(signal);
}

function getSignalEvidence(pick: V0Pick): SignalEvidence[] {
  const rawEvidence = pick.metadata.signal_evidence;
  if (!Array.isArray(rawEvidence)) return [];

  return rawEvidence
    .filter(isRecord)
    .map((item) => ({
      signal: typeof item.signal === "string" ? item.signal : undefined,
      category: typeof item.category === "string" ? item.category : null,
      rank: typeof item.rank === "number" ? item.rank : null,
      reasoning: typeof item.reasoning === "string" ? item.reasoning : null,
    }));
}

function buildFilterParams(filters: FilterState): V0FilterParams {
  return {
    date: filters.date,
    tier: filters.tier,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    minMarketCap: filters.minMarketCap,
    maxMarketCap: filters.maxMarketCap,
    minRvol: filters.minRvol,
    minGap: filters.minGap,
    direction: filters.direction,
    catalyst: filters.catalyst.trim(),
    topScope: filters.topScope,
    limit: filters.limit,
  };
}

function countActiveFilters(filters: FilterState): number {
  return [
    filters.date,
    filters.tier,
    filters.minPrice,
    filters.maxPrice,
    filters.minMarketCap,
    filters.maxMarketCap,
    filters.minRvol,
    filters.minGap,
    filters.direction,
    filters.catalyst.trim(),
    filters.topScope !== "all" ? filters.topScope : "",
  ].filter(Boolean).length;
}

function Sparkline({ values, isPositive }: { values: number[]; isPositive: boolean }) {
  if (!values || values.length < 2) return null;

  const width = 80;
  const height = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="opacity-80" aria-hidden="true">
      <polyline points={points} fill="none" stroke={isPositive ? "#34d399" : "#f87171"} strokeWidth="1.5" />
    </svg>
  );
}

function V0TopCatalystCard({ pick }: { pick: V0Pick }) {
  const reasons = Array.isArray(pick.top_catalyst_reasons) ? pick.top_catalyst_reasons : [];
  const tier = pick.top_catalyst_tier === 1 ? 1 : 2;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex gap-4">
        <div className="shrink-0 font-mono text-lg font-black text-slate-400">#{pick.top_catalyst_rank ?? "-"}</div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-wrap items-baseline gap-3">
              <Link href={`/research-v2/${pick.symbol}`} className="font-mono text-xl font-bold text-cyan-300 hover:underline">
                {pick.symbol}
              </Link>
              {pick.display_price != null && <span className="text-lg font-medium text-zinc-200">{formatMoney(pick.display_price)}</span>}
              {pick.change_pct != null && (
                <span className={pick.change_pct >= 0 ? "text-sm font-medium text-emerald-400" : "text-sm font-medium text-red-400"}>
                  {formatPercent(pick.change_pct)}
                </span>
              )}
            </div>
            <span className={`inline-flex w-fit items-center rounded-xl border px-4 py-1.5 text-sm font-black uppercase tracking-[0.2em] ${getAlignmentBadgeClass(tier === 1 ? 4 : 3)}`}>
              Tier {tier}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-300">
            {pick.sector ? <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">{pick.sector}</span> : null}
            {pick.rvol != null ? <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">RVOL {pick.rvol.toFixed(2)}x</span> : null}
            {pick.gap_percent != null ? <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">Gap {formatPercent(pick.gap_percent)}</span> : null}
          </div>
          {reasons.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {reasons.map((reason) => (
                <span key={`${pick.pick_id}-${reason}`} className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300">
                  {reason}
                </span>
              ))}
            </div>
          ) : null}
          {pick.narrative_thesis ? (
            <p className="text-sm leading-relaxed text-zinc-100">{pick.narrative_thesis}</p>
          ) : (
            <p className="text-sm italic text-zinc-400">{pick.reasoning || "Narrative pending..."}</p>
          )}
        </div>
      </div>
    </div>
  );
}

type RegenerateNarrativeResponse = {
  narrative_thesis: string | null;
  narrative_watch_for: string | null;
  narrative_generated_at: string | null;
};

function V0PickCard({ pick }: { pick: V0Pick }) {
  const [regenerating, setRegenerating] = useState(false);
  const [localPick, setLocalPick] = useState(pick);
  const alignmentCount = getAlignmentCount(localPick);
  const signalEvidence = getSignalEvidence(localPick);

  useEffect(() => {
    setLocalPick(pick);
  }, [pick]);

  const handleRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);

    try {
      const response = await apiFetch(`/api/v2/beacon-v0/regenerate-narrative/${encodeURIComponent(localPick.pick_id)}`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.detail || errorBody.error || `HTTP ${response.status}`);
      }

      const data = (await response.json()) as RegenerateNarrativeResponse;
      setLocalPick((previous) => ({
        ...previous,
        narrative_thesis: data.narrative_thesis,
        narrative_watch_for: data.narrative_watch_for,
        narrative_generated_at: data.narrative_generated_at,
      }));
      alert("Narrative regenerated");
    } catch (error) {
      console.error("[beacon] regenerate failed:", error);
      alert(`Regenerate failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-3">
          <Link href={`/research-v2/${localPick.symbol}`} className="font-mono text-xl font-bold text-cyan-300 hover:underline">
            {localPick.symbol}
          </Link>
          {localPick.display_price != null && <span className="text-lg font-medium text-zinc-200">{formatMoney(localPick.display_price)}</span>}
          {localPick.change_pct != null && (
            <span className={localPick.change_pct >= 0 ? "text-sm font-medium text-emerald-400" : "text-sm font-medium text-red-400"}>
              {formatPercent(localPick.change_pct)}
            </span>
          )}
          {localPick.sparkline && localPick.sparkline.length > 1 && (
            <Sparkline values={localPick.sparkline} isPositive={(localPick.change_pct ?? 0) >= 0} />
          )}
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-xl border px-4 py-1.5 text-sm font-black uppercase tracking-[0.2em] ${getAlignmentBadgeClass(alignmentCount)}`}>
              Alignment · {alignmentCount} {alignmentCount === 1 ? "Signal" : "Signals"}
            </span>
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
              title="Regenerate narrative"
              aria-label="Regenerate narrative"
            >
              <RefreshCw size={14} className={regenerating ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
            <span>{localPick.pattern}</span>
            {localPick.direction ? <span>{localPick.direction}</span> : null}
            {localPick.top_catalyst_tier ? <span>Tier {localPick.top_catalyst_tier}</span> : null}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
        {localPick.sector ? <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">{localPick.sector}</span> : null}
        {localPick.market_cap != null ? <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">Cap {formatCompactNumber(localPick.market_cap)}</span> : null}
        {localPick.rvol != null ? <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">RVOL {localPick.rvol.toFixed(2)}x</span> : null}
        {localPick.gap_percent != null ? <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">Gap {formatPercent(localPick.gap_percent)}</span> : null}
        {Array.isArray(localPick.catalyst_labels)
          ? localPick.catalyst_labels.slice(0, 3).map((label) => (
              <span key={`${localPick.pick_id}-${label}`} className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-400">
                {label}
              </span>
            ))
          : null}
      </div>

      <div className={`mt-3 transition-opacity duration-200 ${regenerating ? "opacity-40" : "opacity-100"}`}>
        {localPick.narrative_thesis ? (
          <>
            <p className="text-sm leading-relaxed text-zinc-100">{localPick.narrative_thesis}</p>
            {localPick.narrative_watch_for ? (
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                <span className="mr-1 uppercase tracking-wider text-zinc-500">Watch for:</span>
                {localPick.narrative_watch_for}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm italic text-zinc-400">{localPick.reasoning || "Narrative pending..."}</p>
        )}
      </div>

      {signalEvidence.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {signalEvidence.slice(0, 4).map((evidence, index) => {
            const forwardLooking = isForwardLookingSignal(evidence.signal);

            return (
              <div
                key={`${localPick.symbol}-${evidence.signal || index}`}
                className={`rounded-lg border p-3 ${
                  forwardLooking
                    ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_14px_rgba(16,185,129,0.12)]"
                    : "border-slate-800 bg-slate-900/70"
                }`}
              >
                <div className="flex items-start justify-between gap-2 text-xs">
                  <div>
                    <span className={forwardLooking ? "font-medium text-emerald-100" : "font-medium text-slate-200"}>
                      {evidence.signal || "Signal"}
                    </span>
                    <div className="mt-1">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                          forwardLooking
                            ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200"
                            : "border-slate-700 bg-slate-800 text-slate-400"
                        }`}
                      >
                        {forwardLooking ? "Forward setup" : "Observed move"}
                      </span>
                    </div>
                  </div>
                  <span className="text-slate-500">Rank {evidence.rank ?? "-"}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">
                  {evidence.reasoning || evidence.category || "Signal evidence available."}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MarketContextPanel({
  contextQuery,
}: {
  contextQuery: UseQueryResult<BeaconMarketContextResponse, Error>;
}) {
  if (contextQuery.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="h-5 w-32 animate-pulse rounded bg-slate-800/70" />
          <div className="h-16 animate-pulse rounded bg-slate-800/60" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-14 animate-pulse rounded bg-slate-800/60" />
            <div className="h-14 animate-pulse rounded bg-slate-800/60" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (contextQuery.isError || !contextQuery.data?.data) {
    return (
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="pt-5 text-sm text-amber-200">Market context is temporarily unavailable.</CardContent>
      </Card>
    );
  }

  const context = contextQuery.data.data;
  const meta = contextQuery.data.meta;

  return (
    <Card className="border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.12),_transparent_35%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.96))]">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg text-slate-100">Market Context</CardTitle>
            <p className="mt-1 text-sm text-slate-400">Opening bias, sector leadership, and catalyst load for today&apos;s Beacon run.</p>
          </div>
          <Badge variant="accent" className="w-fit uppercase tracking-[0.18em]">
            {context.opening_bias}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm leading-6 text-slate-100">
          {context.narrative}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: "Regime", value: context.market_regime },
            { label: "Volatility", value: context.volatility_level },
            { label: "Breadth", value: context.breadth_percent != null ? `${context.breadth_percent.toFixed(1)}%` : "-" },
            { label: "Earnings Today", value: String(context.earnings_today_count) },
            { label: "Strongest Sector", value: context.strongest_sector || "-" },
            { label: "Weakest Sector", value: context.weakest_sector || "-" },
            { label: "Macro Headlines", value: String(context.macro_today_count) },
            { label: "Cache", value: meta.cache_hit ? "warm" : "fresh" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{stat.label}</div>
              <div className="mt-1 text-sm font-semibold text-slate-100">{stat.value}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(context.indices || {}).map(([symbol, index]) => (
            <div key={symbol} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-semibold text-slate-100">{symbol}</span>
                <span className={index.change_percent != null && index.change_percent >= 0 ? "text-sm text-emerald-400" : "text-sm text-red-400"}>
                  {formatPercent(index.change_percent)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                <span>{formatMoney(index.price)}</span>
                <span>RVOL {index.relative_volume != null ? `${index.relative_volume.toFixed(2)}x` : "-"}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs text-slate-500">
          Snapshot {formatTimestamp(context.source_snapshot_at)} · refreshed {formatTimestamp(meta.cached_at)}
        </div>
      </CardContent>
    </Card>
  );
}

function FiltersPanel({
  filters,
  onChange,
  onReset,
  activeCount,
}: {
  filters: FilterState;
  onChange: (key: keyof FilterState, value: string) => void;
  onReset: () => void;
  activeCount: number;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg text-slate-100">Picks Filters</CardTitle>
            <p className="mt-1 text-sm text-slate-400">Filter Beacon v0 by date, tier, price, cap, RVOL, gap, direction, and catalyst label.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="accent" className="w-fit uppercase tracking-[0.18em]">
              {activeCount} active
            </Badge>
            <button
              type="button"
              onClick={onReset}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              Reset
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Date
            <input type="date" value={filters.date} onChange={(event) => onChange("date", event.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Tier
            <select value={filters.tier} onChange={(event) => onChange("tier", event.target.value)} className={INPUT_CLASS}>
              <option value="">All tiers</option>
              <option value="1">Tier 1</option>
              <option value="2">Tier 2</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Direction
            <select value={filters.direction} onChange={(event) => onChange("direction", event.target.value)} className={INPUT_CLASS}>
              <option value="">All directions</option>
              <option value="up">Up</option>
              <option value="down">Down</option>
              <option value="neutral">Neutral</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Top catalyst scope
            <select value={filters.topScope} onChange={(event) => onChange("topScope", event.target.value)} className={INPUT_CLASS}>
              <option value="all">All picks</option>
              <option value="only">Only top catalysts</option>
              <option value="exclude">Exclude top catalysts</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Min price
            <input type="number" min="0" step="0.01" value={filters.minPrice} onChange={(event) => onChange("minPrice", event.target.value)} className={INPUT_CLASS} placeholder="5" />
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Max price
            <input type="number" min="0" step="0.01" value={filters.maxPrice} onChange={(event) => onChange("maxPrice", event.target.value)} className={INPUT_CLASS} placeholder="100" />
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Min market cap
            <input type="number" min="0" step="1000000" value={filters.minMarketCap} onChange={(event) => onChange("minMarketCap", event.target.value)} className={INPUT_CLASS} placeholder="1000000000" />
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Max market cap
            <input type="number" min="0" step="1000000" value={filters.maxMarketCap} onChange={(event) => onChange("maxMarketCap", event.target.value)} className={INPUT_CLASS} placeholder="50000000000" />
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Min RVOL
            <input type="number" min="0" step="0.1" value={filters.minRvol} onChange={(event) => onChange("minRvol", event.target.value)} className={INPUT_CLASS} placeholder="1.5" />
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Min gap %
            <input type="number" min="0" step="0.1" value={filters.minGap} onChange={(event) => onChange("minGap", event.target.value)} className={INPUT_CLASS} placeholder="2" />
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 md:col-span-2 xl:col-span-1">
            Catalyst label contains
            <input value={filters.catalyst} onChange={(event) => onChange("catalyst", event.target.value)} className={INPUT_CLASS} placeholder="earnings, news, volume" />
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            Result limit
            <input type="number" min="1" max="100" step="1" value={filters.limit} onChange={(event) => onChange("limit", event.target.value)} className={INPUT_CLASS} placeholder="30" />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

export function V0PreviewTab() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const filterParams = useMemo(() => buildFilterParams(filters), [filters]);
  const activeFilters = useMemo(() => countActiveFilters(filters), [filters]);

  const query = useQuery({
    queryKey: ["beacon", "v0", "picks", filterParams],
    queryFn: () => fetchV0Picks(filterParams),
    ...BEACON_QUERY_OPTIONS,
  });

  const marketContextQuery = useQuery({
    queryKey: ["beacon", "market-context"],
    queryFn: fetchBeaconMarketContext,
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
  };

  const topCatalystPicks = useMemo(() => {
    if (!query.data?.picks) {
      return [];
    }
    return query.data.picks
      .filter((pick) => pick.top_catalyst_tier && pick.top_catalyst_rank)
      .sort((left, right) => Number(left.top_catalyst_rank || 999) - Number(right.top_catalyst_rank || 999))
      .slice(0, 5);
  }, [query.data]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <FiltersPanel filters={filters} onChange={handleFilterChange} onReset={() => setFilters(DEFAULT_FILTERS)} activeCount={activeFilters} />
        <MarketContextPanel contextQuery={marketContextQuery} />
      </div>

      {query.isLoading ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="h-6 w-56 animate-pulse rounded bg-slate-800/70" />
            <div className="h-4 w-72 animate-pulse rounded bg-slate-800/70" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded bg-slate-800/60" />
            ))}
          </CardContent>
        </Card>
      ) : query.isError || !query.data ? (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 text-sm text-red-200">Beacon v0 is temporarily unavailable. Try refreshing.</CardContent>
        </Card>
      ) : query.data.picks.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-lg text-slate-100">BEACON v0 PREVIEW</CardTitle>
                <p className="mt-1 text-sm text-slate-400">No picks matched the current filter set.</p>
              </div>
              <Badge variant="accent" className="w-fit uppercase tracking-[0.18em]">v0</Badge>
            </div>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-lg text-slate-100">BEACON v0 PREVIEW</CardTitle>
                <p className="mt-1 text-sm text-slate-400">
                  {query.data.count} picks · run date {query.data.as_of_date || "-"} · generated {formatTimestamp(query.data.generated_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {query.isFetching ? <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Refreshing</span> : null}
                <Badge variant="accent" className="w-fit uppercase tracking-[0.18em]">v0</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {topCatalystPicks.length > 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-black uppercase tracking-[0.24em] text-slate-100">Top Catalysts In Scope</h3>
                  <p className="mt-1 text-xs text-slate-500">Highest-conviction Beacon v0 setups within the current filter set.</p>
                </div>
                <div className="space-y-3">
                  {topCatalystPicks.map((pick) => (
                    <V0TopCatalystCard key={`top-${pick.pick_id || `${pick.symbol}-${pick.pattern}`}`} pick={pick} />
                  ))}
                </div>
              </div>
            ) : null}

            {query.data.picks.map((pick) => (
              <V0PickCard key={pick.pick_id || `${pick.symbol}-${pick.pattern}`} pick={pick} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
