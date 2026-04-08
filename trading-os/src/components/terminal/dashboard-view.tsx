"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useMarketClock } from "@/utils/marketSession";
import { classifyConditions, type Condition } from "@/utils/conditionClassifier";

// ── Types ─────────────────────────────────────────────────────────────────────

type IndexRow = {
  symbol: string;
  label: string;
  price: number;
  changesPercentage: number;
};

type StockRow = {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  volume: number;
};

type EarningsRow = {
  symbol: string;
  time: string;
  epsEstimated: number | null;
  revenueEstimated: number | null;
};

type NewsRow = {
  symbol: string;
  title: string;
  url: string;
  site: string;
  publishedDate: string;
};

type SectorRow = {
  sector: string;
  changesPercentage: number;
};

type Snapshot = {
  gainers: StockRow[];
  losers: StockRow[];
  active: StockRow[];
  indices: IndexRow[];
  sectors: SectorRow[];
  earnings: EarningsRow[];
  news: NewsRow[];
  fear: { value: number; valueClassification: string } | null;
  timestamp: string;
};

type BriefingSection = {
  title: string;
  bullets: string[];
};

type Briefing = {
  sections: BriefingSection[];
  fallback?: boolean;
  message?: string;
  generatedAt?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(n: number, digits = 2): string {
  const v = Number(n) || 0;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function fmtVol(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtPrice(n: number): string {
  return `$${Number(n).toFixed(2)}`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function pctColor(v: number, inverted = false): string {
  const positive = inverted ? v < 0 : v > 0;
  const negative = inverted ? v > 0 : v < 0;
  if (positive) return "text-emerald-400";
  if (negative) return "text-rose-400";
  return "text-slate-400";
}

function isEarningsBMO(time: string): boolean {
  const t = (time || "").toLowerCase();
  return t.includes("bmo") || t.includes("pre") || t.includes("before");
}

function isEarningsAMC(time: string): boolean {
  const t = (time || "").toLowerCase();
  return t.includes("amc") || t.includes("after") || t.includes("post");
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Pulse({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-slate-800/60",
        className
      )}
    />
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-panel p-4 space-y-2">
      <Pulse className="h-3 w-24" />
      <Pulse className="h-6 w-32" />
      <Pulse className="h-3 w-16" />
    </div>
  );
}

// ── Phase dot colour ──────────────────────────────────────────────────────────

function phaseDotColor(phase: string): string {
  switch (phase) {
    case "opening":
    case "morning":
    case "afternoon":
    case "powerhour":
      return "bg-emerald-400";
    case "premarket":
    case "afterhours":
      return "bg-amber-400";
    case "midday":
      return "bg-blue-400";
    case "weekend":
    case "closed":
    case "overnight":
      return "bg-slate-500";
    default:
      return "bg-slate-500";
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
      {label}
    </p>
  );
}

function StockTable({
  rows,
  label,
  showVolume = true,
}: {
  rows: StockRow[];
  label: string;
  showVolume?: boolean;
}) {
  // Auto-hide volume column when all rows have zero volume (endpoint doesn't provide it)
  const hasVolume = showVolume && rows.some((r) => r.volume > 0);
  if (!rows.length) {
    return (
      <div>
        <SectionHeader label={label} />
        <p className="text-xs text-slate-600">No data available</p>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader label={label} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-600 border-b border-border">
              <th className="text-left py-1.5 pr-3 font-medium">#</th>
              <th className="text-left py-1.5 pr-3 font-medium">Ticker</th>
              <th className="text-right py-1.5 pr-3 font-medium">Price</th>
              <th className="text-right py-1.5 pr-3 font-medium">Chg%</th>
              {hasVolume && <th className="text-right py-1.5 font-medium">Volume</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.symbol}
                className="border-b border-border/40 last:border-0 hover:bg-slate-800/20 transition-colors"
              >
                <td className="py-1.5 pr-3 text-slate-600">{i + 1}</td>
                <td className="py-1.5 pr-3">
                  <span className="font-semibold text-slate-200 font-mono text-[11px]">
                    {row.symbol}
                  </span>
                  {row.name && (
                    <span className="ml-2 text-slate-600 hidden sm:inline truncate max-w-[100px]">
                      {row.name.slice(0, 20)}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-slate-300">
                  {fmtPrice(row.price)}
                </td>
                <td className={cn("py-1.5 pr-3 text-right font-mono font-semibold", pctColor(row.changesPercentage))}>
                  {fmtPct(row.changesPercentage)}
                </td>
                {hasVolume && (
                  <td className="py-1.5 text-right text-slate-500 font-mono">
                    {fmtVol(row.volume)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectorBar({ sector, value }: { sector: string; value: number }) {
  const abs = Math.abs(value);
  const maxPct = 3; // saturate at ±3%
  const width = Math.min((abs / maxPct) * 100, 100);
  const isPos = value >= 0;

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs text-slate-400 w-36 shrink-0 truncate capitalize">
        {sector.toLowerCase()}
      </span>
      <div className="flex-1 relative h-4 rounded-sm overflow-hidden bg-slate-800/40">
        <div
          className={cn(
            "absolute top-0 h-full rounded-sm transition-all",
            isPos ? "left-0 bg-emerald-500/30" : "right-0 bg-rose-500/30"
          )}
          style={{ width: `${width}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-end pr-2">
          <span className={cn("text-[10px] font-mono font-semibold", pctColor(value))}>
            {fmtPct(value)}
          </span>
        </div>
      </div>
    </div>
  );
}

function EarningsGroup({
  label,
  items,
}: {
  label: string;
  items: EarningsRow[];
}) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 mb-1.5">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {items.map((e) => (
          <div
            key={e.symbol}
            className="rounded border border-border bg-slate-800/30 px-2 py-1 text-[11px]"
          >
            <span className="font-mono font-semibold text-slate-200">{e.symbol}</span>
            {e.epsEstimated !== null && (
              <span className="ml-1.5 text-slate-500">EPS est {e.epsEstimated.toFixed(2)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DeclinersRow({ losers }: { losers: StockRow[] }) {
  if (!losers.length) return null;
  return (
    <div>
      <SectionHeader label="Notable Decliners" />
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {losers.slice(0, 8).map((row) => (
          <div
            key={row.symbol}
            className="rounded-lg border border-rose-500/20 bg-rose-950/20 p-3 text-center"
          >
            <div className="font-mono font-bold text-slate-200 text-sm">{row.symbol}</div>
            <div className="font-mono font-semibold text-rose-400 text-base mt-0.5">
              {fmtPct(row.changesPercentage)}
            </div>
            {row.volume > 0 && (
              <div className="text-[10px] text-slate-500 mt-0.5">{fmtVol(row.volume)} vol</div>
            )}
            <div className="text-[10px] text-slate-400 font-mono">{fmtPrice(row.price)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewsCard({ item }: { item: NewsRow }) {
  const symbol = (item.symbol || "").trim();
  const title = (item.title || "").trim();
  const url = (item.url || "").trim();
  const site = (item.site || "").trim();
  const ago = timeAgo(item.publishedDate);

  const content = (
    <div className="rounded-lg border border-border bg-panel/60 p-3 h-full hover:bg-slate-800/40 transition-colors group">
      <div className="flex items-start gap-2 mb-1.5">
        {symbol && (
          <span className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-300">
            {symbol}
          </span>
        )}
        {site && (
          <span className="text-[10px] text-slate-600 shrink-0">{site}</span>
        )}
        <span className="ml-auto text-[10px] text-slate-600 shrink-0">{ago}</span>
      </div>
      <p className="text-xs text-slate-300 leading-snug line-clamp-3 group-hover:text-slate-200 transition-colors">
        {title || "No title"}
      </p>
      {url && (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-600 group-hover:text-blue-400 transition-colors">
          <ExternalLink className="size-3" />
          <span>Read more</span>
        </div>
      )}
    </div>
  );

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        {content}
      </a>
    );
  }
  return content;
}

// ── AI Briefing Section ───────────────────────────────────────────────────────

const SECTION_ORDER = [
  "LAST TRADING SESSION",
  "LATEST NEWS",
  "WEEKLY TRENDS",
  "RISK ASSESSMENT",
  "CONDITIONS & SETUPS",
  "SUMMARY",
];

function BriefingCard({
  briefing,
  isLoading,
}: {
  briefing: Briefing | undefined;
  isLoading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  // Sort sections in canonical order
  const sections = useMemo(() => {
    if (!briefing?.sections) return [];
    const ordered: BriefingSection[] = [];
    for (const title of SECTION_ORDER) {
      const found = briefing.sections.find(
        (s) => s.title.toUpperCase() === title.toUpperCase()
      );
      if (found) ordered.push(found);
    }
    // Add any remaining sections not in the canonical order
    for (const s of briefing.sections) {
      if (!ordered.find((o) => o.title === s.title)) ordered.push(s);
    }
    return ordered;
  }, [briefing?.sections]);

  const summarySection = sections.find(
    (s) => s.title.toUpperCase().includes("SUMMARY")
  );
  const previewBullet = summarySection?.bullets?.[0] || null;
  const ago = briefing?.generatedAt ? timeAgo(briefing.generatedAt) : null;

  return (
    <div className="rounded-lg border border-border bg-panel shadow-sm">
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-200">AI analysis</span>
          <span className="text-indigo-400 text-sm">✦</span>
        </div>
        {ago && <span className="text-xs text-slate-600">{ago}</span>}
      </div>

      <div className="p-4 space-y-3">
        {/* Loading state */}
        {isLoading && !briefing && (
          <div className="space-y-3">
            <Pulse className="h-3 w-full" />
            <Pulse className="h-3 w-5/6" />
            <Pulse className="h-3 w-4/5" />
          </div>
        )}

        {/* Fallback */}
        {!isLoading && briefing?.fallback && (
          <p className="text-sm text-slate-500 italic">
            {briefing.message || "AI narrative unavailable. All market data is live below."}
          </p>
        )}

        {/* Summary preview (always visible) */}
        {!isLoading && !briefing?.fallback && previewBullet && (
          <p className="text-sm text-slate-300 leading-relaxed">{previewBullet}</p>
        )}

        {/* Expand toggle */}
        {!briefing?.fallback && sections.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronUp className="size-3.5" />
                  Collapse briefing
                </>
              ) : (
                <>
                  <ChevronDown className="size-3.5" />
                  Expand full briefing
                </>
              )}
            </button>

            {expanded && (
              <div className="space-y-5 pt-2">
                {sections.map((section, i) => (
                  <div key={section.title}>
                    {i > 0 && (
                      <div className="border-t border-border/40 mb-4" />
                    )}
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
                      {section.title}
                    </p>
                    <div className="rounded-lg border border-border/40 bg-slate-900/40 p-3 space-y-2.5">
                      {(section.bullets || []).map((bullet, j) => (
                        <div key={j} className="flex gap-2.5">
                          <span className="mt-0.5 shrink-0 text-indigo-400 text-sm leading-none">✦</span>
                          <p className="text-xs text-slate-400 leading-relaxed">{bullet}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Disclaimer */}
        <p className="text-[10px] text-slate-700 pt-1 border-t border-border/30 mt-3">
          AI analysis is generated automatically and does not constitute financial advice.
          Data sourced from FMP. Do your own research.
        </p>
      </div>
    </div>
  );
}

// ── Condition Tags ────────────────────────────────────────────────────────────

function ConditionTag({ condition }: { condition: Condition }) {
  return (
    <div
      title={condition.description}
      className="rounded border px-2 py-1 text-[11px] font-semibold cursor-default group relative"
      style={{
        borderColor: `${condition.color}40`,
        backgroundColor: `${condition.color}15`,
        color: condition.color,
      }}
    >
      {condition.label}
      <div className="pointer-events-none absolute bottom-full left-0 mb-1.5 z-50 hidden group-hover:block w-56 rounded-lg border border-border bg-slate-900 p-2.5 shadow-xl">
        <p className="text-[10px] text-slate-300 leading-relaxed">{condition.description}</p>
      </div>
    </div>
  );
}

// ── Index Card ────────────────────────────────────────────────────────────────

function IndexCard({ row }: { row: IndexRow }) {
  const isVIX = row.symbol === "VIX";
  const changeColor = pctColor(row.changesPercentage, isVIX);

  return (
    <div className="rounded-lg border border-border bg-panel p-3 flex flex-col gap-0.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {row.label}
      </p>
      <p className="text-lg font-bold font-mono text-slate-100">
        {row.price > 0 ? fmtPrice(row.price) : "—"}
      </p>
      <p className={cn("text-xs font-mono font-semibold", changeColor)}>
        {row.price > 0 ? fmtPct(row.changesPercentage) : "—"}
      </p>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function DashboardView() {
  const session = useMarketClock();

  // ── Snapshot ────────────────────────────────────────────────────────────────
  const snapshotQuery = useQuery<Snapshot>({
    queryKey: ["dashboard", "snapshot"],
    queryFn: () => apiGet<Snapshot>("/api/dashboard/snapshot"),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const snapshot = snapshotQuery.data;
  const isLoading = snapshotQuery.isLoading;

  // ── Conditions (client-side, derived from snapshot) ─────────────────────────
  const conditions = useMemo(() => {
    if (!snapshot) return [] as Condition[];
    return classifyConditions(snapshot, session);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, session.phase, session.orbWindow, session.ukWindow]);

  // ── AI Briefing ─────────────────────────────────────────────────────────────
  const briefingQuery = useQuery<Briefing>({
    queryKey: ["dashboard", "briefing", session.phase],
    queryFn: async () => {
      return apiPost<Briefing>("/api/dashboard/briefing", {
        session,
        snapshot,
        conditions: conditions.map((c) => c.label),
      });
    },
    enabled: !!snapshot,
    staleTime: 3 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  const briefing = briefingQuery.data;

  // ── Earnings grouping ───────────────────────────────────────────────────────
  const earnings = snapshot?.earnings ?? [];
  const earningsBMO = earnings.filter((e) => isEarningsBMO(e.time));
  const earningsAMC = earnings.filter((e) => isEarningsAMC(e.time));
  const earningsTBC = earnings.filter(
    (e) => !isEarningsBMO(e.time) && !isEarningsAMC(e.time)
  );

  // ── Manual refresh ──────────────────────────────────────────────────────────
  function handleRefresh() {
    snapshotQuery.refetch();
    briefingQuery.refetch();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const dotColor = phaseDotColor(session.phase);

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">

      {/* ── Session header ───────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Left: phase + date */}
          <div className="flex items-center gap-2.5">
            <span className={cn("size-2 rounded-full shrink-0 animate-pulse", dotColor)} />
            <span className="text-sm font-semibold text-slate-200">{session.label}</span>
            <span className="text-xs text-slate-500">{session.date}</span>
          </div>

          {/* Right: times */}
          <div className="flex items-center gap-4 text-xs text-slate-400 font-mono">
            <span>ET {session.et}</span>
            <span className="text-slate-600">·</span>
            <span>UK {session.uk}</span>
            {session.orbWindow && (
              <span className="rounded bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-amber-400 font-sans font-semibold text-[10px]">
                ⚡ ORB LIVE
              </span>
            )}
            {session.ukWindow && (
              <span className="rounded bg-blue-500/20 border border-blue-500/30 px-2 py-0.5 text-blue-400 font-sans font-semibold text-[10px]">
                🇬🇧 UK WINDOW
              </span>
            )}
          </div>
        </div>

        {/* Countdown strip */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
          <div className="text-xs text-slate-500">
            <span className="font-semibold text-slate-400">NEXT →</span>{" "}
            {session.nextEvent}{" "}
            <span className="font-mono font-semibold text-slate-300">{session.countdown}</span>
          </div>
          <div className="flex items-center gap-3">
            {snapshot && (
              <span className="text-[10px] text-slate-600">
                Updated {timeAgo(snapshot.timestamp)}
              </span>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={snapshotQuery.isFetching}
              className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={cn("size-3", snapshotQuery.isFetching && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* ── Condition tags ───────────────────────────────────────────────────── */}
      {conditions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {conditions.map((c) => (
            <ConditionTag key={c.label} condition={c} />
          ))}
        </div>
      )}

      {/* ── Indices ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          : (snapshot?.indices ?? []).map((row) => (
              <IndexCard key={row.symbol} row={row} />
            ))}
      </div>

      {/* ── AI Analyst Briefing ──────────────────────────────────────────────── */}
      <BriefingCard
        briefing={briefing}
        isLoading={briefingQuery.isLoading || (snapshotQuery.isLoading && !briefing)}
      />

      {/* ── Main data grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Left column */}
        <div className="space-y-4">
          {/* Most Active */}
          <div className="rounded-lg border border-border bg-panel p-4">
            {isLoading ? (
              <>
                <Pulse className="h-3 w-24 mb-3" />
                {Array.from({ length: 6 }).map((_, i) => (
                  <Pulse key={i} className="h-8 w-full mb-1" />
                ))}
              </>
            ) : (
              <StockTable rows={snapshot?.active ?? []} label="Volume Leaders — Most Active" />
            )}
          </div>

          {/* Sector heat map */}
          <div className="rounded-lg border border-border bg-panel p-4">
            <SectionHeader label="Sector Heat Map" />
            {isLoading ? (
              <div className="space-y-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Pulse key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : (snapshot?.sectors ?? []).length > 0 ? (
              <div>
                {(snapshot?.sectors ?? []).slice(0, 11).map((s) => (
                  <SectorBar
                    key={s.sector}
                    sector={s.sector}
                    value={s.changesPercentage}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600">Sector data unavailable</p>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Top Gainers */}
          <div className="rounded-lg border border-border bg-panel p-4">
            {isLoading ? (
              <>
                <Pulse className="h-3 w-24 mb-3" />
                {Array.from({ length: 6 }).map((_, i) => (
                  <Pulse key={i} className="h-8 w-full mb-1" />
                ))}
              </>
            ) : (
              <StockTable rows={snapshot?.gainers ?? []} label="Top Gainers — % Change" />
            )}
          </div>

          {/* Earnings today */}
          <div className="rounded-lg border border-border bg-panel p-4">
            <SectionHeader label={`Earnings Today${earnings.length ? ` (${earnings.length})` : ""}`} />
            {isLoading ? (
              <Pulse className="h-20 w-full" />
            ) : earnings.length === 0 ? (
              <p className="text-xs text-slate-600">No earnings scheduled today</p>
            ) : (
              <>
                <EarningsGroup label="Before Open" items={earningsBMO} />
                <EarningsGroup label="After Close" items={earningsAMC} />
                <EarningsGroup label="TBC" items={earningsTBC} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Notable Decliners ────────────────────────────────────────────────── */}
      {!isLoading && (snapshot?.losers ?? []).length > 0 && (
        <div className="rounded-lg border border-border bg-panel p-4">
          <DeclinersRow losers={snapshot?.losers ?? []} />
        </div>
      )}

      {/* ── Latest Headlines ─────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-panel p-4">
        <SectionHeader label="Latest Headlines" />
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Pulse key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : (snapshot?.news ?? []).length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(snapshot?.news ?? []).slice(0, 12).map((item, i) => (
              <NewsCard key={`${item.symbol}-${i}`} item={item} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600">No headlines available</p>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between py-2 text-[10px] text-slate-700 border-t border-border/30">
        <span>OPENRANGE TERMINAL · DATA-DRIVEN INTELLIGENCE</span>
        <span>Auto-refresh 5min · FMP + GPT-4o pipeline</span>
      </div>
    </div>
  );
}
