"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type ScreenerRow = {
  symbol: string | null;
  price: number | null;
  change_percent: number | null;
  volume: number | null;
  rvol: number | null;
  gap_percent: number | null;
  latest_news_at?: string | null;
  news_source: "fmp" | "database" | "none";
  earnings_date?: string | null;
  earnings_source: "fmp" | "database" | "yahoo" | "none";
  catalyst_type: "NEWS" | "RECENT_NEWS" | "EARNINGS" | "TECHNICAL" | "NONE";
  sector: string | null;
  updated_at: string | null;
  why: string;
  driver_type: "MACRO" | "SECTOR" | "NEWS" | "EARNINGS" | "TECHNICAL";
  confidence: number;
  linked_symbols: string[];
};

type ScreenerResponse = {
  success: boolean;
  count: number;
  fallbackUsed: boolean;
  data: ScreenerRow[];
};

type OpportunityRow = {
  symbol: string;
  score: number;
  why: string;
  bias: "continuation" | "reversal" | "chop";
  risk: "low" | "medium" | "high";
  watch: string;
  confidence: number;
  tradeable: boolean;
};

type OpportunitiesResponse = {
  success: boolean;
  count: number;
  data: OpportunityRow[];
};

const SKELETON_ROWS = Array.from({ length: 10 }, (_, index) => index);

function sortRows(rows: ScreenerRow[]) {
  return [...rows].sort((left, right) => {
    const leftRvol = left.rvol ?? -1;
    const rightRvol = right.rvol ?? -1;
    if (rightRvol !== leftRvol) return rightRvol - leftRvol;

    const leftChange = Math.abs(left.change_percent ?? 0);
    const rightChange = Math.abs(right.change_percent ?? 0);
    if (rightChange !== leftChange) return rightChange - leftChange;

    return String(left.symbol ?? "").localeCompare(String(right.symbol ?? ""));
  });
}

function resolveUpdatedTimestamp(rows: ScreenerRow[]) {
  let latestTimestamp = 0;

  for (const row of rows) {
    const parsed = Date.parse(row.updated_at ?? "");
    if (!Number.isNaN(parsed) && parsed > latestTimestamp) {
      latestTimestamp = parsed;
    }
  }

  return latestTimestamp > 0 ? latestTimestamp : Date.now();
}

function formatUpdatedTime(timestamp: number | null) {
  if (!timestamp) return "--:--:--";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function formatPrice(value: number | null) {
  if (value === null) return "—";
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number | null) {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatVolume(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatRvol(value: number | null) {
  if (value === null) return "—";
  if (value > 50) return ">50x";
  if (value > 100) return `${(value / 100).toFixed(1)}x`;
  return `${value.toFixed(2)}x`;
}

function formatGap(value: number | null) {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatCatalyst(type: ScreenerRow["catalyst_type"]) {
  switch (type) {
    case "NEWS":
      return { icon: "🟢", label: "News" };
    case "RECENT_NEWS":
      return { icon: "🟠", label: "Recent News" };
    case "EARNINGS":
      return { icon: "🟣", label: "Earnings" };
    case "TECHNICAL":
      return { icon: "🟡", label: "Technical" };
    default:
      return { icon: "⚪", label: "No clear catalyst" };
  }
}

function getNewsFreshness(publishedAt: string | null | undefined) {
  if (!publishedAt) {
    return { tone: "text-slate-400", label: "—" };
  }

  const publishedTime = Date.parse(publishedAt);
  if (Number.isNaN(publishedTime)) {
    return { tone: "text-slate-400", label: "—" };
  }

  const minutes = Math.max(0, Math.floor((Date.now() - publishedTime) / 60000));
  if (minutes < 60) return { tone: "text-emerald-400", label: `${Math.max(1, minutes)}m` };
  if (minutes < 1440) return { tone: "text-emerald-400", label: `${Math.floor(minutes / 60)}h` };
  if (minutes < 10080) return { tone: "text-amber-300", label: `${Math.floor(minutes / 1440)}d` };
  return { tone: "text-slate-400", label: `${Math.floor(minutes / 1440)}d` };
}

function getEarningsLabel(earningsDate: string | null | undefined) {
  if (!earningsDate) return "No data";

  const target = new Date(`${earningsDate}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return "No data";

  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const dayDiff = Math.round((targetDay - today) / 86400000);

  if (dayDiff === 0) return "Today";
  if (dayDiff > 0) return `In ${dayDiff}d`;
  return `${Math.abs(dayDiff)}d ago`;
}

function formatDriverType(type: ScreenerRow["driver_type"]) {
  switch (type) {
    case "MACRO":
      return {
        label: "Macro",
        className: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200",
      };
    case "SECTOR":
      return {
        label: "Sector",
        className: "border-sky-500/30 bg-sky-500/10 text-sky-200",
      };
    case "NEWS":
      return {
        label: "News",
        className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
      };
    case "EARNINGS":
      return {
        label: "Earnings",
        className: "border-amber-500/30 bg-amber-500/10 text-amber-200",
      };
    default:
      return {
        label: "Technical",
        className: "border-slate-500/30 bg-slate-500/10 text-slate-200",
      };
  }
}

function formatConfidence(value: number) {
  if (value >= 0.8) {
    return {
      label: "HIGH",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    };
  }

  if (value >= 0.4) {
    return {
      label: "MED",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    };
  }

  return {
    label: "LOW",
    className: "border-slate-500/30 bg-slate-500/10 text-slate-200",
  };
}

function SkeletonTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]">
      <table className="min-w-full divide-y divide-slate-800 text-sm">
        <thead className="bg-slate-950/90 text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
          <tr>
            {[
              "Symbol",
              "Price",
              "% Change",
              "Volume",
              "RVOL",
              "Gap %",
              "Catalyst",
              "Why",
              "News",
              "Earnings",
              "Sector",
            ].map((label) => (
              <th key={label} className="px-4 py-3 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SKELETON_ROWS.map((row) => (
            <tr key={row} className="animate-pulse border-t border-slate-900">
              {Array.from({ length: 11 }, (_, cell) => (
                <td key={cell} className="px-4 py-3">
                  <div className="h-4 rounded bg-slate-800/80" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ScreenerV2Page() {
  const [data, setData] = useState<ScreenerRow[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData(showLoading: boolean) {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const [screenerResponse, opportunitiesResponse] = await Promise.all([
          apiFetch("/api/v2/screener", { cache: "no-store" }),
          apiFetch("/api/v2/opportunities", { cache: "no-store" }),
        ]);

        if (!screenerResponse.ok) {
          throw new Error(`Request failed (${screenerResponse.status})`);
        }

        const payload = (await screenerResponse.json()) as ScreenerResponse;
        const opportunitiesPayload = opportunitiesResponse.ok
          ? ((await opportunitiesResponse.json()) as OpportunitiesResponse)
          : { success: false, count: 0, data: [] };

        if (!cancelled) {
          const nextRows = sortRows(Array.isArray(payload.data) ? payload.data : []);
          setData(nextRows);
          setOpportunities(Array.isArray(opportunitiesPayload.data) ? opportunitiesPayload.data.slice(0, 3) : []);
          setUpdatedAt(resolveUpdatedTimestamp(nextRows));
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load screener");
          setData([]);
          setOpportunities([]);
          setUpdatedAt(null);
        }
      } finally {
        if (!cancelled && showLoading) {
          setLoading(false);
        }
      }
    }

    fetchData(true);
    const refreshTimer = window.setInterval(() => {
      fetchData(false);
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, []);

  return (
    <section className="space-y-5 text-slate-100">
      <header className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_32%),linear-gradient(180deg,_rgba(15,23,42,0.96),_rgba(2,6,23,0.96))] p-6 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-400/80">Manual Mode</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Screener V2</h1>
          </div>
          <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            {`${data.length} stocks • Updated ${formatUpdatedTime(updatedAt)}`}
          </div>
        </div>
        <p className="max-w-3xl text-sm text-slate-400">
          Clean view over the trusted v2 screener feed. No derived scoring, no extra fetches, no legacy components.
        </p>
      </header>

      {!loading && opportunities.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-3">
          {opportunities.map((row) => {
            const confidence = formatConfidence(row.confidence);
            return (
              <div key={row.symbol} className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-4 text-sm shadow-[0_0_0_1px_rgba(15,23,42,0.3)]">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Top 3 Focus Today</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <Link href={`/research-v2/${encodeURIComponent(row.symbol)}`} className="text-base font-semibold text-white underline-offset-4 hover:text-emerald-300 hover:underline">
                    {row.symbol}
                  </Link>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
                    {row.score.toFixed(0)}
                  </span>
                </div>
                <p className="mt-3 line-clamp-1 text-sm text-slate-300">{row.why}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium uppercase tracking-[0.16em]">
                  <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-sky-200">
                    {row.bias}
                  </span>
                  <span className={cn("rounded-full border px-2.5 py-1", confidence.className)}>
                    {confidence.label}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">{row.watch}</p>
              </div>
            );
          })}
        </div>
      ) : null}

      {loading ? (
        <SkeletonTable />
      ) : data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/70 px-6 py-12 text-center">
          <p className="text-base font-medium text-slate-200">No data available — check backend</p>
          {error ? <p className="mt-2 text-sm text-slate-500">{error}</p> : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 shadow-[0_0_0_1px_rgba(15,23,42,0.35)]">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-950/95 text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">% Change</th>
                <th className="px-4 py-3 font-medium">Volume</th>
                <th className="px-4 py-3 font-medium">RVOL</th>
                <th className="px-4 py-3 font-medium">Gap %</th>
                <th className="px-4 py-3 font-medium">Catalyst</th>
                <th className="px-4 py-3 font-medium">Why</th>
                <th className="px-4 py-3 font-medium">News</th>
                <th className="px-4 py-3 font-medium">Earnings</th>
                <th className="px-4 py-3 font-medium">Sector</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const news = getNewsFreshness(row.latest_news_at);
                const earningsLabel = getEarningsLabel(row.earnings_date);
                const catalyst = formatCatalyst(row.catalyst_type);
                const driver = formatDriverType(row.driver_type);
                const confidence = formatConfidence(row.confidence);

                return (
                  <tr key={row.symbol} className="border-t border-slate-900/80 transition hover:bg-slate-900/60">
                    <td className="px-4 py-3">
                      <Link
                        href={`/research-v2/${encodeURIComponent(row.symbol || "")}`}
                        className="font-semibold tracking-wide text-slate-100 underline-offset-4 hover:text-emerald-300 hover:underline"
                      >
                        {row.symbol || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-200">{formatPrice(row.price)}</td>
                    <td
                      className={cn(
                        "px-4 py-3 font-medium",
                        (row.change_percent ?? 0) > 0 && "text-emerald-400",
                        (row.change_percent ?? 0) < 0 && "text-rose-400",
                        row.change_percent === 0 && "text-slate-300"
                      )}
                    >
                      {formatPercent(row.change_percent)}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{formatVolume(row.volume)}</td>
                    <td className={cn("px-4 py-3 text-slate-300", (row.rvol ?? 0) > 2 && "font-semibold text-amber-300")}>{formatRvol(row.rvol)}</td>
                    <td className="px-4 py-3 text-slate-300">{formatGap(row.gap_percent)}</td>
                    <td className="px-4 py-3 text-slate-300">
                      <span className="mr-2">{catalyst.icon}</span>
                      <span>{catalyst.label}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-2">
                          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em]", driver.className)}>
                            {driver.label}
                          </span>
                          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em]", confidence.className)}>
                            {confidence.label}
                          </span>
                        </div>
                        <p className="max-w-[18rem] text-xs leading-5 text-slate-300">{row.why}</p>
                        {row.linked_symbols.length > 0 ? (
                          <p className="max-w-[18rem] text-[11px] leading-5 text-slate-400">
                            {`Also moving: ${row.linked_symbols.join(", ")}`}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className={cn("px-4 py-3", news.tone)} title={news.label}>
                      <span>{news.label}</span>
                      {row.latest_news_at && row.news_source === "database" ? (
                        <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">DB</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <span>{earningsLabel}</span>
                      {row.earnings_date && row.earnings_source === "database" ? (
                        <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">DB</span>
                      ) : null}
                      {row.earnings_date && row.earnings_source === "yahoo" ? (
                        <span className="ml-2 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">Yahoo</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{row.sector || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}