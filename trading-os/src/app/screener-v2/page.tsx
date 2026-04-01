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
  earnings_date?: string | null;
  sector: string | null;
  updated_at: string | null;
};

type ScreenerResponse = {
  success: boolean;
  count: number;
  fallbackUsed: boolean;
  data: ScreenerRow[];
};

const SKELETON_ROWS = Array.from({ length: 10 }, (_, index) => index);

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
  return `${value.toFixed(2)}x`;
}

function formatGap(value: number | null) {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function getNewsFreshness(publishedAt: string | null | undefined) {
  if (!publishedAt) {
    return { dot: "🔴", label: "No recent news" };
  }

  const publishedTime = Date.parse(publishedAt);
  if (Number.isNaN(publishedTime)) {
    return { dot: "🔴", label: "Stale news timestamp" };
  }

  const minutes = Math.max(0, Math.floor((Date.now() - publishedTime) / 60000));
  if (minutes < 5) return { dot: "🟢", label: `${minutes}m ago` };
  if (minutes < 60) return { dot: "🟡", label: `${minutes}m ago` };
  return { dot: "🔴", label: `${Math.floor(minutes / 60)}h ago` };
}

function getEarningsLabel(earningsDate: string | null | undefined) {
  if (!earningsDate) return "—";

  const target = new Date(`${earningsDate}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return "—";

  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const dayDiff = Math.round((targetDay - today) / 86400000);

  if (dayDiff < 0) return "—";
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  return `${dayDiff}d`;
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
              {Array.from({ length: 9 }, (_, cell) => (
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData(showLoading: boolean) {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const response = await apiFetch("/api/v2/screener", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const payload = (await response.json()) as ScreenerResponse;
        if (!cancelled) {
          setData(Array.isArray(payload.data) ? payload.data : []);
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load screener");
          setData([]);
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
            One endpoint · 60s refresh
          </div>
        </div>
        <p className="max-w-3xl text-sm text-slate-400">
          Clean view over the trusted v2 screener feed. No derived scoring, no extra fetches, no legacy components.
        </p>
      </header>

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
                <th className="px-4 py-3 font-medium">News</th>
                <th className="px-4 py-3 font-medium">Earnings</th>
                <th className="px-4 py-3 font-medium">Sector</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const news = getNewsFreshness(row.latest_news_at);
                const earningsLabel = getEarningsLabel(row.earnings_date);

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
                    <td className="px-4 py-3 text-slate-300" title={news.label}>
                      <span className="mr-2">{news.dot}</span>
                      <span>{news.label}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{earningsLabel}</td>
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