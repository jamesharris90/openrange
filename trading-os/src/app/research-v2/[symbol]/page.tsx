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

type Narrative = {
  summary: string;
  driver: string;
  strength: "strong" | "weak";
  tradeable: boolean;
  bias: "continuation" | "reversal" | "chop";
  setup_type: "momentum continuation" | "mean reversion" | "breakout" | "fade" | "chop / avoid";
  confidence_reason: string;
  watch: string;
  risk: "low" | "medium" | "high";
  generated_at: string;
};

type ResearchResponse = {
  success: boolean;
  data: {
    symbol: string;
    screener: ScreenerRow;
    narrative: Narrative;
  };
};

type Props = {
  params: {
    symbol: string;
  };
};

function formatPercent(value: number | null) {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
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

function narrativeBadgeTone(value: string) {
  switch (value) {
    case "strong":
    case "continuation":
    case "low":
    case "yes":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "weak":
    case "reversal":
    case "high":
    case "no":
      return "border-rose-500/30 bg-rose-500/10 text-rose-200";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
}

function formatGeneratedAt(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
}

export default function ResearchV2SymbolPage({ params }: Props) {
  const symbol = params.symbol.toUpperCase();
  const [data, setData] = useState<ResearchResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadResearch() {
      setLoading(true);
      setError(null);

      try {
        const response = await apiFetch(`/api/v2/research/${encodeURIComponent(symbol)}`, {
          cache: "no-store",
        });

        const payload = (await response.json()) as Partial<ResearchResponse> & { error?: string };
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || `Failed to load research for ${symbol}`);
        }

        if (!cancelled) {
          setData(payload.data);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load research");
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadResearch();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const screener = data?.screener;
  const narrative = data?.narrative;
  const driver = screener ? formatDriverType(screener.driver_type) : null;
  const confidence = screener ? formatConfidence(screener.confidence) : null;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-8 text-slate-100 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-400/80">Research V2</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{symbol}</h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Deterministic screener output first, GPT narrative second. This layer runs only on the research page.
          </p>
        </div>
        <Link
          href="/screener-v2"
          className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
        >
          Back to Screener V2
        </Link>
      </div>

      {loading ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 animate-pulse">
            <div className="h-4 w-28 rounded bg-slate-800" />
            <div className="mt-4 h-5 w-3/4 rounded bg-slate-800" />
            <div className="mt-3 h-4 w-full rounded bg-slate-800" />
            <div className="mt-2 h-4 w-5/6 rounded bg-slate-800" />
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 animate-pulse">
            <div className="h-4 w-32 rounded bg-slate-800" />
            <div className="mt-4 h-4 w-full rounded bg-slate-800" />
            <div className="mt-2 h-4 w-11/12 rounded bg-slate-800" />
            <div className="mt-2 h-4 w-4/5 rounded bg-slate-800" />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-8 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {!loading && !error && screener && narrative ? (
        <div className="mt-8 space-y-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">WHY</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em]">
                {driver ? (
                  <span className={cn("rounded-full border px-2.5 py-1", driver.className)}>{driver.label}</span>
                ) : null}
                {confidence ? (
                  <span className={cn("rounded-full border px-2.5 py-1", confidence.className)}>
                    {confidence.label} Confidence
                  </span>
                ) : null}
                <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-slate-300">
                  {formatPercent(screener.change_percent)}
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-slate-300">
                  {screener.sector || "Unknown sector"}
                </span>
              </div>
              <p className="mt-4 text-lg font-medium text-slate-100">{screener.why}</p>
              {screener.linked_symbols.length ? (
                <p className="mt-3 text-sm text-slate-400">
                  Also moving: <span className="text-slate-200">{screener.linked_symbols.join(", ")}</span>
                </p>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No linked peer cluster detected in the current screener snapshot.</p>
              )}
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_45%),rgba(2,6,23,0.82)] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-300/80">AI Trade View</p>
                  <p className="mt-1 text-xs text-slate-400">Cached for 5 minutes. Generated {formatGeneratedAt(narrative.generated_at)}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-200">{narrative.summary}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Bias</p>
                  <p className={cn("mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em]", narrativeBadgeTone(narrative.bias))}>
                    {narrative.bias}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Tradeable</p>
                  <p className={cn("mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em]", narrativeBadgeTone(narrative.tradeable ? "yes" : "no"))}>
                    {narrative.tradeable ? "YES" : "NO"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Strength</p>
                  <p className={cn("mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em]", narrativeBadgeTone(narrative.strength))}>
                    {narrative.strength}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{narrative.confidence_reason}</p>
                </div>
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Risk</p>
                  <p className={cn("mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em]", narrativeBadgeTone(narrative.risk))}>
                    {narrative.risk === "medium" ? "MED" : narrative.risk.toUpperCase()}
                  </p>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Setup Type</p>
                <p className="mt-2 text-sm leading-6 text-slate-200">{narrative.setup_type}</p>
              </div>
              <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">What To Watch</p>
                <p className="mt-2 text-sm leading-6 text-slate-200">{narrative.watch}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}