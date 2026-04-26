"use client";

import Link from "next/link";
import { Component, memo, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";

import { ChartEngine, CHART_TIMEFRAME_OPTIONS, type ChartTimeframe } from "@/components/charts/chart-engine";
import CatalystPanel from "@/components/research/CatalystPanel";
import { cn } from "@/lib/utils";

type Props = {
  params: {
    symbol: string;
  };
};

type MCPData = {
  summary?: string;
  why?: string;
  what?: string;
  where?: string | null;
  where_status?: "pending" | "available" | string | null;
  upper_level?: number | null;
  lower_level?: number | null;
  when?: string;
  confidence?: number;
  confidence_reason?: string;
  trade_quality?: string;
  improve?: string;
  action?: string;
  trade_score?: number;
  expected_move?: {
    value?: number | null;
    percent?: number | null;
    label?: string;
  };
  risk?: {
    entry?: number | null;
    invalidation?: number | null;
    reward?: number | null;
    rr?: number | null;
  };
};

type MarketData = {
  price?: number | null;
  change_percent?: number | null;
  volume?: number | null;
  market_cap?: number | null;
  relative_volume?: number | null;
  updated_at?: string | null;
};

type TechnicalsData = {
  atr?: number | null;
  rsi?: number | null;
  vwap?: number | null;
  relative_volume?: number | null;
  avg_volume_30d?: number | null;
  sma_20?: number | null;
  sma_50?: number | null;
  sma_200?: number | null;
};

type NewsItem = {
  id?: string | null;
  title?: string | null;
  headline?: string | null;
  summary?: string | null;
  source?: string | null;
  url?: string | null;
  published_at?: string | null;
  publishedAt?: string | null;
  context_scope?: string | null;
  contextScope?: string | null;
};

type EarningsRecord = {
  report_date?: string | null;
  report_time?: string | null;
  eps_estimate?: number | null;
  eps_actual?: number | null;
  revenue_estimate?: number | null;
  revenue_actual?: number | null;
  event_state?: string | null;
  earnings_outcome?: string | null;
  has_actuals?: boolean | null;
  has_estimates?: boolean | null;
  eps_surprise_pct?: number | null;
  revenue_surprise_pct?: number | null;
};

type CompanyData = {
  company_name?: string | null;
  sector?: string | null;
  industry?: string | null;
  description?: string | null;
  exchange?: string | null;
  country?: string | null;
  website?: string | null;
  stock_classification?: string | null;
  stock_classification_label?: string | null;
  stock_classification_reason?: string | null;
  listing_type?: string | null;
  instrument_detail?: string | null;
  instrument_detail_label?: string | null;
};

type ResearchData = {
  symbol: string;
  market?: MarketData;
  technicals?: TechnicalsData;
  chart?: { data?: unknown[] } | unknown[] | null;
  news?: NewsItem[];
  data_confidence?: number | null;
  data_confidence_label?: "HIGH" | "MEDIUM" | "LOW" | null;
  data_quality_label?: "HIGH" | "MEDIUM" | "LOW" | null;
  earnings?: {
    latest?: EarningsRecord | null;
    next?: EarningsRecord | null;
    history?: EarningsRecord[];
  };
  company?: CompanyData;
  mcp?: MCPData;
  warnings?: ResearchWarning[];
};

type ResearchWarning = {
  reason?: string | null;
  message?: string | null;
};

type PayloadPhase = "idle" | "fast_loading" | "fast_loaded" | "full_loading" | "full_loaded" | "error";

const CHART_TIMEFRAME_STORAGE_KEY = "research_chart_timeframe";

type ResearchResponse = {
  status?: string;
  source?: string;
  success?: boolean;
  data_confidence?: number | null;
  data_confidence_label?: "HIGH" | "MEDIUM" | "LOW" | null;
  data_quality_label?: "HIGH" | "MEDIUM" | "LOW" | null;
  data?: ResearchData;
  error?: string;
  meta?: {
    fallback?: boolean;
    reason?: string | null;
    phase?: string | null;
    response_ms?: number;
    warnings?: ResearchWarning[];
  };
};

const newsCache = new Map<string, {
  data: NewsItem[];
  timestamp: number;
}>();

const CACHE_TTL = 60_000;

function normalizeNewsPayload(payload: unknown): NewsItem[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] })?.data)
      ? (payload as { data: NewsItem[] }).data
      : Array.isArray((payload as { items?: unknown[] })?.items)
        ? (payload as { items: NewsItem[] }).items
        : [];

  return rows.reduce<NewsItem[]>((items, item) => {
      const headline = String(item?.headline || item?.title || "").trim();
      if (!headline) {
        return items;
      }

      items.push({
        id: item?.id || headline,
        title: headline,
        summary: item?.summary || null,
        source: item?.source || null,
        url: item?.url || null,
        published_at: item?.published_at || item?.publishedAt || null,
        publishedAt: item?.publishedAt || item?.published_at || null,
        context_scope: item?.context_scope || item?.contextScope || null,
        contextScope: item?.contextScope || item?.context_scope || null,
      });

      return items;
    }, []).slice(0, 5);
}

function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "No data available";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "No data available";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatLargeNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "No data available";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "No data available";
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(numeric);
}

function toDisplayNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "No data available";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(parsed));
}

function isHydratingPhase(phase: PayloadPhase) {
  return phase === "fast_loading" || phase === "fast_loaded" || phase === "full_loading";
}

function normalizeWarning(value: unknown): ResearchWarning | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const lower = value.toLowerCase();
    const reason = lower.includes("timeout")
      ? "fmp_timeout"
      : lower.includes("chart")
        ? "chart_unavailable"
        : lower.includes("seed") || lower.includes("fallback")
          ? "seeded_fallback"
          : "partial_data";
    return { reason, message: value };
  }

  if (typeof value === "object") {
    const warning = value as { reason?: unknown; message?: unknown };
    return {
      reason: String(warning.reason || "partial_data"),
      message: warning.message ? String(warning.message) : null,
    };
  }

  return null;
}

function getBannerMessage(warnings: ResearchWarning[], meta: ResearchResponse["meta"] | null): string | null {
  const reasons = new Set(warnings.map((warning) => String(warning.reason || "").trim()).filter(Boolean));

  if (meta?.fallback) {
    reasons.add("seeded_fallback");
  }
  if (String(meta?.reason || "").toLowerCase().includes("timeout")) {
    reasons.add("fmp_timeout");
  }

  if (reasons.has("seeded_fallback")) return "Showing cached data — live fetch unavailable";
  if (reasons.has("fmp_timeout")) return "Upstream data source slow — some fields may be limited";
  if (reasons.has("chart_unavailable")) return "Chart temporarily unavailable";
  if (reasons.has("partial_data")) return "Some data sections are incomplete";
  if (reasons.has("fast_payload")) return null;

  return reasons.size > 0 ? "Some data temporarily limited" : null;
}

function formatEarningsLabel(value: string | null | undefined, fallback = "No data available") {
  const text = String(value || "").trim();
  if (!text) {
    return fallback;
  }

  return text
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function isPendingEarningsRow(row: EarningsRecord | null | undefined) {
  const state = String(row?.event_state || "").trim().toUpperCase();
  const outcome = String(row?.earnings_outcome || "").trim().toUpperCase();

  return outcome === "PENDING" || state === "UPCOMING" || state === "AWAITING_ACTUALS";
}

function isReportedEarningsRow(row: EarningsRecord | null | undefined) {
  if (!row) {
    return false;
  }

  const state = String(row.event_state || "").trim().toUpperCase();
  return row.has_actuals === true || (state === "REPORTED" || state === "PARTIAL_RESULT") && !isPendingEarningsRow(row);
}

function hasUsableEarningsRow(row: EarningsRecord | null | undefined) {
  if (!row) {
    return false;
  }

  return [
    row.report_date,
    row.report_time,
    row.eps_estimate,
    row.eps_actual,
    row.revenue_estimate,
    row.revenue_actual,
    row.event_state,
    row.earnings_outcome,
  ].some((value) => value !== null && value !== undefined && value !== "");
}

function formatCompactMetricNumber(value: number | string | null | undefined, digits = 2) {
  const numeric = toDisplayNumber(value);
  if (numeric === null) {
    return "--";
  }

  return numeric.toFixed(digits);
}

function formatCompactLargeNumber(value: number | string | null | undefined) {
  const formatted = formatLargeNumber(value);
  return formatted === "No data available" ? "--" : formatted;
}

function formatCompactSurprise(value: number | string | null | undefined) {
  const numeric = toDisplayNumber(value);
  if (numeric === null) {
    return "--";
  }

  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(1)}%`;
}

function formatEarningsTime(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) {
    return "Time not set";
  }

  return formatEarningsLabel(text, text);
}

function formatActualEstimatePair(
  actual: number | string | null | undefined,
  estimate: number | string | null | undefined,
  formatter: (value: number | string | null | undefined) => string,
) {
  const actualValue = formatter(actual);
  const estimateValue = formatter(estimate);

  if (actualValue === "--" && estimateValue === "--") {
    return "--";
  }

  if (actualValue === "--") {
    return `Est ${estimateValue}`;
  }

  if (estimateValue === "--") {
    return `Actual ${actualValue}`;
  }

  return `${actualValue} / ${estimateValue}`;
}

function earningsOutcomeTone(row: EarningsRecord | null | undefined) {
  const outcome = String(row?.earnings_outcome || "").trim().toUpperCase();
  const state = String(row?.event_state || "").trim().toUpperCase();

  if (outcome === "BEAT") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }

  if (outcome === "MISS") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  }

  if (outcome === "MEET") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }

  if (state === "UPCOMING" || outcome === "PENDING") {
    return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
  }

  return "border-slate-700 bg-slate-900/70 text-slate-300";
}

function surpriseTone(value: number | string | null | undefined) {
  const numeric = toDisplayNumber(value);
  if (numeric === null) {
    return "text-slate-400";
  }

  if (numeric > 0) {
    return "text-emerald-300";
  }

  if (numeric < 0) {
    return "text-rose-300";
  }

  return "text-amber-300";
}

function getChartRows(chart: ResearchData["chart"] | undefined) {
  if (Array.isArray(chart)) {
    return chart;
  }

  if (Array.isArray(chart?.data)) {
    return chart.data;
  }

  if (Array.isArray((chart as { daily?: unknown[] } | undefined)?.daily)) {
    return (chart as { daily: unknown[] }).daily;
  }

  if (Array.isArray((chart as { intraday?: unknown[] } | undefined)?.intraday)) {
    return (chart as { intraday: unknown[] }).intraday;
  }

  return [];
}

function badgeTone(value: string | undefined) {
  switch (String(value || "").toUpperCase()) {
    case "BUY":
    case "HIGH":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "WAIT":
    case "WATCH":
    case "MEDIUM":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "AVOID":
    case "LOW":
      return "border-rose-500/30 bg-rose-500/10 text-rose-200";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-200";
  }
}

function resolveDataQualityLabel(data: ResearchData | null, response: ResearchResponse | null) {
  return data?.data_quality_label || data?.data_confidence_label || response?.data_quality_label || response?.data_confidence_label || "LOW";
}

function formatMetricNumber(value: number | string | null | undefined, digits = 1) {
  const numeric = toDisplayNumber(value);
  if (numeric === null) {
    return "--";
  }

  return numeric.toFixed(digits);
}

const InfoPanel = memo(function InfoPanel({
  title,
  value,
  muted,
}: {
  title: string;
  value: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <p className={cn("mt-2 text-sm leading-6", muted ? "text-slate-400" : "text-slate-200")}>{value}</p>
    </div>
  );
});

function FieldSkeleton({ width = "w-24" }: { width?: string }) {
  return <div className={cn("h-5 animate-pulse rounded bg-slate-700/50", width)} />;
}

function phaseAwareValue(value: string | null | undefined, phase: PayloadPhase, width?: string) {
  const text = String(value || "").trim();
  if (text) {
    return text;
  }
  if (isHydratingPhase(phase)) {
    return <FieldSkeleton width={width} />;
  }
  return "—";
}

function useResearchChartTimeframe(): [ChartTimeframe, (timeframe: ChartTimeframe) => void] {
  const [timeframe, setTimeframeState] = useState<ChartTimeframe>("daily");

  useEffect(() => {
    const stored = window.localStorage.getItem(CHART_TIMEFRAME_STORAGE_KEY);
    if (CHART_TIMEFRAME_OPTIONS.some((option) => option.value === stored)) {
      setTimeframeState(stored as ChartTimeframe);
    }
  }, []);

  const setTimeframe = (nextTimeframe: ChartTimeframe) => {
    setTimeframeState(nextTimeframe);
    window.localStorage.setItem(CHART_TIMEFRAME_STORAGE_KEY, nextTimeframe);
  };

  return [timeframe, setTimeframe];
}

function EmptyState({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <div className={cn(
      "rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 text-center text-slate-400",
      compact ? "px-4 py-4 text-sm" : "px-6 py-10 text-base"
    )}>
      {message}
    </div>
  );
}

function ErrorUI({
  title = "Research page unavailable",
  message = "The page hit a client-side render error. Retry the navigation or refresh the page.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-100 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-2 text-sm text-rose-100/80">{message}</p>
    </div>
  );
}

type ResearchErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type ResearchErrorBoundaryState = {
  hasError: boolean;
};

class ResearchErrorBoundary extends Component<ResearchErrorBoundaryProps, ResearchErrorBoundaryState> {
  state: ResearchErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ResearchErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("RESEARCH RENDER ERROR:", error);
    console.error("RESEARCH RENDER STACK:", errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

const OverviewPanel = memo(function OverviewPanel({ data, symbol, phase }: { data: ResearchData | null; symbol: string; phase: PayloadPhase }) {
  const company = data?.company || {};
  const earnings = data?.earnings || {};
  const earningsHistory = Array.isArray(earnings.history) ? earnings.history : [];
  const latestEarnings = earnings.latest ?? null;
  const nextEarnings = earnings.next ?? null;
  const hasUpcomingSummary = hasUsableEarningsRow(nextEarnings);
  const hasLatestSummary = hasUsableEarningsRow(latestEarnings);
  const nextEarningsPending = isPendingEarningsRow(nextEarnings);
  const latestEarningsReported = isReportedEarningsRow(latestEarnings);
  const recentHistory = earningsHistory.slice(0, 4);
  const limitedCoverageMessage = !hasUpcomingSummary && hasLatestSummary
    ? "Upcoming scheduling is not in the current feed yet. Latest reported quarter is shown first."
    : hasUpcomingSummary && !hasLatestSummary && recentHistory.length === 0
      ? "Upcoming earnings are scheduled, but reported-quarter coverage is still limited."
      : !hasUpcomingSummary && !hasLatestSummary && recentHistory.length > 0
        ? "Only partial historical earnings rows are available right now."
        : recentHistory.length > 0 && recentHistory.length < 3
          ? "Historical coverage is limited to a small sample right now."
          : null;
  const latestStatusLabel = latestEarningsReported
    ? formatEarningsLabel(latestEarnings?.earnings_outcome || latestEarnings?.event_state, "Reported")
    : hasLatestSummary
      ? formatEarningsLabel(latestEarnings?.event_state || latestEarnings?.earnings_outcome, "Latest on file")
      : "No reported quarter";
  const nextStatusLabel = hasUpcomingSummary
    ? formatEarningsLabel(nextEarnings?.event_state || nextEarnings?.earnings_outcome, nextEarningsPending ? "Upcoming" : "Scheduled")
    : "No upcoming date";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Overview</p>
        <p className="mt-3 text-lg font-medium text-slate-100">{company.company_name || symbol}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <InfoPanel title="Sector" value={phaseAwareValue(company.sector, phase)} muted />
          <InfoPanel title="Industry" value={phaseAwareValue(company.industry, phase, "w-32")} muted />
          <InfoPanel title="Exchange" value={phaseAwareValue(company.exchange, phase)} muted />
          <InfoPanel title="Country" value={phaseAwareValue(company.country, phase)} muted />
          <InfoPanel title="Classification" value={phaseAwareValue(company.stock_classification_label, phase, "w-28")} muted />
          <InfoPanel title="Instrument Detail" value={phaseAwareValue(company.instrument_detail_label, phase, "w-28")} muted />
          <InfoPanel title="Listing Type" value={phaseAwareValue(company.listing_type, phase, "w-28")} muted />
        </div>
        <div className="mt-4 text-sm leading-6 text-slate-400">
          {company.description || (isHydratingPhase(phase) ? <FieldSkeleton width="w-full" /> : "—")}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Earnings</p>
        {limitedCoverageMessage ? (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {limitedCoverageMessage}
          </div>
        ) : null}
        {!hasUpcomingSummary && !hasLatestSummary && !earningsHistory.length ? (
          <div className="mt-4">
            <EmptyState compact message="Earnings coverage is still thin for this symbol right now." />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {(!hasUpcomingSummary && hasLatestSummary) ? (
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Latest Result</p>
                      <p className="mt-2 text-lg font-semibold text-slate-100">{formatDate(latestEarnings?.report_date)}</p>
                    </div>
                    <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.16em] uppercase", earningsOutcomeTone(latestEarnings))}>
                      {latestStatusLabel}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">EPS Actual / Est</p>
                      <p className="mt-2 text-sm font-medium text-slate-100">{formatActualEstimatePair(latestEarnings?.eps_actual ?? null, latestEarnings?.eps_estimate ?? null, (value) => formatCompactMetricNumber(value, 2))}</p>
                      <p className={cn("mt-1 text-xs", surpriseTone(latestEarnings?.eps_surprise_pct ?? null))}>Surprise {formatCompactSurprise(latestEarnings?.eps_surprise_pct ?? null)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Revenue Actual / Est</p>
                      <p className="mt-2 text-sm font-medium text-slate-100">{formatActualEstimatePair(latestEarnings?.revenue_actual ?? null, latestEarnings?.revenue_estimate ?? null, formatCompactLargeNumber)}</p>
                      <p className={cn("mt-1 text-xs", surpriseTone(latestEarnings?.revenue_surprise_pct ?? null))}>Surprise {formatCompactSurprise(latestEarnings?.revenue_surprise_pct ?? null)}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Upcoming Earnings</p>
                      <p className="mt-2 text-lg font-semibold text-slate-100">{hasUpcomingSummary ? formatDate(nextEarnings?.report_date) : "No upcoming date"}</p>
                    </div>
                    <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.16em] uppercase", earningsOutcomeTone(nextEarnings))}>
                      {nextStatusLabel}
                    </span>
                  </div>
                  {hasUpcomingSummary ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Report Time</p>
                        <p className="mt-2 text-sm font-medium text-slate-100">{formatEarningsTime(nextEarnings?.report_time)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">EPS Estimate</p>
                        <p className="mt-2 text-sm font-medium text-slate-100">{formatCompactMetricNumber(nextEarnings?.eps_estimate ?? null, 2)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 sm:col-span-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Revenue Estimate</p>
                        <p className="mt-2 text-sm font-medium text-slate-100">{formatCompactLargeNumber(nextEarnings?.revenue_estimate ?? null)}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-slate-400">No scheduled earnings date is in the current feed yet.</p>
                  )}
                </div>
              )}

              {(!hasUpcomingSummary && hasLatestSummary) ? (
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Upcoming Earnings</p>
                      <p className="mt-2 text-lg font-semibold text-slate-100">No upcoming date</p>
                    </div>
                    <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-[11px] font-semibold tracking-[0.16em] uppercase text-slate-300">
                      Feed pending
                    </span>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-400">No scheduled earnings date is in the current feed yet.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Latest Result</p>
                      <p className="mt-2 text-lg font-semibold text-slate-100">{hasLatestSummary ? formatDate(latestEarnings?.report_date) : "No reported quarter"}</p>
                    </div>
                    <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.16em] uppercase", earningsOutcomeTone(latestEarnings))}>
                      {latestStatusLabel}
                    </span>
                  </div>
                  {hasLatestSummary ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">EPS Actual / Est</p>
                        <p className="mt-2 text-sm font-medium text-slate-100">{formatActualEstimatePair(latestEarnings?.eps_actual ?? null, latestEarnings?.eps_estimate ?? null, (value) => formatCompactMetricNumber(value, 2))}</p>
                        <p className={cn("mt-1 text-xs", surpriseTone(latestEarnings?.eps_surprise_pct ?? null))}>Surprise {formatCompactSurprise(latestEarnings?.eps_surprise_pct ?? null)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Revenue Actual / Est</p>
                        <p className="mt-2 text-sm font-medium text-slate-100">{formatActualEstimatePair(latestEarnings?.revenue_actual ?? null, latestEarnings?.revenue_estimate ?? null, formatCompactLargeNumber)}</p>
                        <p className={cn("mt-1 text-xs", surpriseTone(latestEarnings?.revenue_surprise_pct ?? null))}>Surprise {formatCompactSurprise(latestEarnings?.revenue_surprise_pct ?? null)}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-slate-400">No reported quarter is available in the current feed yet.</p>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Recent History</p>
                  <p className="mt-1 text-sm text-slate-400">Last {recentHistory.length || 0} earnings rows on file.</p>
                </div>
              </div>
              {recentHistory.length ? (
                <div className="mt-3 space-y-2">
                  {recentHistory.map((entry, index) => (
                    <div key={`${symbol}-${entry.report_date || 'na'}-${index}`} className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-200">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-slate-100">{formatDate(entry.report_date)}</span>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] uppercase", earningsOutcomeTone(entry))}>
                          {formatEarningsLabel(entry.earnings_outcome || entry.event_state, "On file")}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                        <span>EPS {formatActualEstimatePair(entry.eps_actual ?? null, entry.eps_estimate ?? null, (value) => formatCompactMetricNumber(value, 2))}</span>
                        <span>Revenue {formatActualEstimatePair(entry.revenue_actual ?? null, entry.revenue_estimate ?? null, formatCompactLargeNumber)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-slate-400">Recent earnings history is still limited for this symbol.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

const FundamentalsPanel = memo(function FundamentalsPanel({ data, phase }: { data: ResearchData | null; phase: PayloadPhase }) {
  const market = data?.market || {};
  const technicals = data?.technicals || {};
  const mcp = data?.mcp || {};
  const whereValue = mcp.where_status === "pending"
    ? (isHydratingPhase(phase) ? <FieldSkeleton width="w-44" /> : "Levels unavailable")
    : mcp.where || "Levels unavailable";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Fundamentals</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoPanel title="Price" value={formatCurrency(market.price ?? null)} muted />
        <InfoPanel title="Relative Volume" value={formatMetricNumber(market.relative_volume ?? technicals.relative_volume ?? null, 2)} muted />
        <InfoPanel title="Volume" value={formatLargeNumber(market.volume ?? null)} muted />
        <InfoPanel title="Market Cap" value={formatLargeNumber(market.market_cap ?? null)} muted />
        <InfoPanel title="RSI" value={formatMetricNumber(technicals.rsi ?? null, 2)} muted />
        <InfoPanel title="VWAP" value={technicals.vwap == null && isHydratingPhase(phase) ? <FieldSkeleton /> : (technicals.vwap == null ? "—" : formatCurrency(technicals.vwap))} muted />
        <InfoPanel title="ATR" value={formatCurrency(technicals.atr ?? null)} muted />
        <InfoPanel title="Where" value={whereValue} muted />
      </div>
    </div>
  );
});

function ResearchV2PageContent({ params }: Props) {
  const rawSymbol = typeof params?.symbol === "string" ? params.symbol : "";
  const symbol = rawSymbol.toUpperCase();
  const hasSymbol = Boolean(symbol);
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [phase, setPhase] = useState<PayloadPhase>("idle");
  const [chartTimeframe, setChartTimeframe] = useResearchChartTimeframe();
  const payload = data?.data || null;
  const researchMeta = data?.meta || null;
  const responseWarnings = useMemo(() => {
    return [
      ...(Array.isArray(payload?.warnings) ? payload.warnings : []),
      ...(Array.isArray(researchMeta?.warnings) ? researchMeta.warnings : []),
    ]
      .map(normalizeWarning)
      .filter((warning): warning is ResearchWarning => Boolean(warning));
  }, [payload?.warnings, researchMeta?.warnings]);
  const bannerMessage = useMemo(() => getBannerMessage(responseWarnings, researchMeta), [responseWarnings, researchMeta]);
  const chartRows = useMemo(() => getChartRows(payload?.chart), [payload?.chart]);
  const catalystNews = useMemo(() => {
    if (Array.isArray(news) && news.length > 0) {
      return news;
    }

    return normalizeNewsPayload(payload?.news);
  }, [news, payload?.news]);
  const dataQualityLabel = resolveDataQualityLabel(payload, data);
  const dataConfidence = toDisplayNumber(payload?.data_confidence ?? data?.data_confidence ?? null);

  useEffect(() => {
    if (symbol) {
      console.log("[RESEARCH-V2 MOUNT]", symbol);
    }
  }, [symbol]);

  useEffect(() => {
    console.log("RESEARCH DATA:", data);
    console.log("CHART DATA:", data?.data?.chart);
    console.log("[RENDER DATA SHAPE]", {
      hasData: !!data,
      keys: data?.data ? Object.keys(data.data) : [],
      hasChart: !!data?.data?.chart,
      hasApiData: !!data?.data,
    });
  }, [data]);

  useEffect(() => {
    if (!hasSymbol) {
      setData(null);
      setError(false);
      setLoading(false);
      setPhase("idle");
      return undefined;
    }

    let isMounted = true;

    async function loadFastResearch() {
      try {
        setLoading(true);
        setError(false);
        setPhase("fast_loading");
        console.log("[RESEARCH FAST FETCH START]", symbol);

        const res = await fetch(`/api/v2/research/${encodeURIComponent(symbol)}?fast=true`, {
          cache: "no-store",
        });
        console.log("[RESEARCH FAST FETCH RESPONSE STATUS]", res.status);

        const json = (await res.json()) as ResearchResponse;
        console.log("[RESEARCH FAST FETCH JSON RAW]", json);
        console.log("[RESEARCH FAST FETCH SUCCESS]", json);

        if (!res.ok || !json?.data) {
          throw new Error(json?.error || `Failed to load research for ${symbol}`);
        }

        if (isMounted) {
          console.log("[RESEARCH FAST SET DATA]", json);
          setData((current) => current?.meta?.phase?.startsWith("full") ? current : json);
          setLoading(false);
          setPhase((currentPhase) => currentPhase === "full_loaded" ? currentPhase : "full_loading");
        }
      } catch (err) {
        console.error("[RESEARCH FAST FETCH ERROR]", err);
        if (isMounted) {
          setData(null);
          setError(true);
          setLoading(false);
          setPhase("error");
        }
      }
    }

    void loadFastResearch();

    return () => {
      console.log("[RESEARCH CLEANUP]", symbol);
      isMounted = false;
    };
  }, [hasSymbol, symbol, reloadKey]);

  useEffect(() => {
    if (!hasSymbol) {
      return undefined;
    }

    let mounted = true;
    const controller = new AbortController();
    setPhase((currentPhase) => currentPhase === "idle" ? "full_loading" : currentPhase);

    async function loadFullResearch() {
      try {
        const response = await fetch(`/api/v2/research/${encodeURIComponent(symbol)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = (await response.json()) as ResearchResponse;
        if (!mounted || !response.ok || !json?.data) {
          return;
        }

        setData((previous) => {
          const mergedData: ResearchData = {
            symbol,
            ...(previous?.data || {}),
            ...(json.data || {}),
          };

          return {
            ...(previous || {}),
            ...json,
            data: mergedData,
            meta: {
              ...(previous?.meta || {}),
              ...(json.meta || {}),
            },
          };
        });
        setPhase("full_loaded");
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("[RESEARCH FULL FETCH ERROR]", error);
          setPhase((currentPhase) => currentPhase === "full_loaded" ? currentPhase : "fast_loaded");
        }
      }
    }

    void loadFullResearch();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [hasSymbol, symbol, reloadKey]);

  useEffect(() => {
    if (!hasSymbol) {
      setNews([]);
      return undefined;
    }

    let mounted = true;
    const cachedEntry = newsCache.get(symbol);
    const cacheAge = cachedEntry ? Date.now() - cachedEntry.timestamp : Number.POSITIVE_INFINITY;

    if (cachedEntry && cacheAge < CACHE_TTL) {
      setNews(cachedEntry.data);
      return () => {
        mounted = false;
      };
    }

    const controller = new AbortController();

    async function loadNews() {
      try {
        const response = await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}&limit=5`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        const items = normalizeNewsPayload(payload);

        if (!mounted) {
          return;
        }

        newsCache.set(symbol, {
          data: items,
          timestamp: Date.now(),
        });
        setNews(items);
      } catch {
        if (mounted) {
          setNews([]);
        }
      }
    }

    void loadNews();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [hasSymbol, symbol]);

  const handleRetry = () => {
    newsCache.delete(symbol);
    setData(null);
    setNews(null);
    setLoading(true);
    setError(false);
    setPhase("fast_loading");
    setReloadKey((value) => value + 1);
  };

  if (!hasSymbol) {
    return <ErrorUI title="Missing research symbol" message="No ticker was provided for this research route." />;
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-8 text-slate-100 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-400/80">Research</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{symbol}</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              Parent-controlled research, chart, and news flow with no child-owned fetches.
            </p>
          </div>
          <Link
            href="/screener-v2"
            className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
          >
            Back to Opportunities
          </Link>
        </div>

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
      </section>
    );
  }

  if (!payload) {
    return (
      <div className="space-y-4">
        <ErrorUI title="Data unavailable for this ticker" message="The research response did not include usable data." />
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex rounded-full border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-8 text-slate-100 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-400/80">Research</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{symbol}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span
              title="Based on data completeness across price, volume, chart, and earnings"
              className={cn("inline-flex items-center rounded-full border px-2.5 py-1 font-medium uppercase tracking-[0.18em]", badgeTone(dataQualityLabel))}
            >
              {dataQualityLabel} confidence
            </span>
            <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-slate-300">
              {dataConfidence === null ? "No data available" : `${Math.round(dataConfidence)}/100`}
            </span>
          </div>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Parent-controlled research, chart, and news flow with no child-owned fetches.
          </p>
        </div>
        <Link
          href="/screener-v2"
          className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
        >
          Back to Opportunities
        </Link>
      </div>

      {error ? (
        <div className="mt-8 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">
          <p className="text-base font-medium text-rose-100">Data unavailable for this ticker</p>
          <p className="mt-2 text-sm text-rose-200/80">The request failed.</p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-4 inline-flex rounded-full border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20"
          >
            Retry
          </button>
        </div>
      ) : null}

      {bannerMessage ? (
        <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          {bannerMessage}
        </div>
      ) : null}

      {!error ? (
        <div className="mt-8 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            {/* Decision card removed Phase 37 — see docs/BEACON_v0_SPEC.md scoring discipline */}
            <OverviewPanel data={payload} symbol={symbol} phase={phase} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <div className="space-y-3">
              <ChartEngine ticker={symbol} timeframe={chartTimeframe} onTimeframeChange={setChartTimeframe} height={340} />
              {!chartRows?.length ? <EmptyState message="No chart data available" compact /> : null}
            </div>
            <CatalystPanel symbol={symbol} news={catalystNews} />
          </div>

            <FundamentalsPanel data={payload} phase={phase} />
        </div>
      ) : null}
    </section>
  );
}

export default function ResearchV2SymbolPage(props: Props) {
  return (
    <ResearchErrorBoundary fallback={<ErrorUI />}>
      <ResearchV2PageContent {...props} />
    </ResearchErrorBoundary>
  );
}
