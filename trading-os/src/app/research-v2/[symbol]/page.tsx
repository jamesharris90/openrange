"use client";

import Link from "next/link";
import { Component, memo, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";

import { ChartEngine } from "@/components/charts/chart-engine";
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
  where?: string;
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
};

type CompanyData = {
  company_name?: string | null;
  sector?: string | null;
  industry?: string | null;
  description?: string | null;
  exchange?: string | null;
  country?: string | null;
  website?: string | null;
};

type ResearchData = {
  symbol: string;
  market?: MarketData;
  technicals?: TechnicalsData;
  chart?: { data?: unknown[] } | unknown[] | null;
  earnings?: {
    latest?: EarningsRecord | null;
    next?: EarningsRecord | null;
  };
  company?: CompanyData;
  mcp?: MCPData;
  warnings?: string[];
};

type ResearchResponse = {
  status?: string;
  source?: string;
  success?: boolean;
  data?: ResearchData;
  error?: string;
  meta?: {
    fallback?: boolean;
    reason?: string | null;
    response_ms?: number;
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

function formatPercent(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) {
    return "No data available";
  }

  const numeric = Number(value);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}%`;
}

function formatCurrency(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) {
    return "No data available";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatLargeNumber(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) {
    return "No data available";
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(Number(value));
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

function getChartRows(chart: ResearchData["chart"] | undefined) {
  if (Array.isArray(chart)) {
    return chart;
  }

  if (Array.isArray(chart?.data)) {
    return chart.data;
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

function normalizeMcpSummary(value: string | undefined) {
  const summary = String(value || "").trim();
  if (summary === "Watch - building setup but no confirmation yet") {
    return "Setup developing — not confirmed yet";
  }
  if (summary === "No trade - lacks catalyst and momentum") {
    return "No trade — insufficient edge";
  }
  if (summary === "Developing setup - wait for confirmation") {
    return "Developing setup — wait for confirmation";
  }
  if (summary === "No edge - avoid until conditions improve") {
    return "No edge — avoid until conditions improve";
  }
  if (summary === "High-quality setup with catalyst and confirmation - tradeable now") {
    return "High-quality setup with catalyst and confirmation — tradeable now";
  }
  return summary || "No trade — insufficient edge";
}

function formatMetricNumber(value: number | null | undefined, digits = 1) {
  if (!Number.isFinite(Number(value))) {
    return "--";
  }

  return Number(value).toFixed(digits);
}

function formatRatio(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) {
    return "--";
  }

  return `${Number(value).toFixed(1)}R`;
}

function confidenceBarTone(confidence: number) {
  if (confidence > 70) {
    return "bg-emerald-400";
  }
  if (confidence >= 40) {
    return "bg-amber-400";
  }
  return "bg-rose-400";
}

const InfoPanel = memo(function InfoPanel({
  title,
  value,
  muted,
}: {
  title: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <p className={cn("mt-2 text-sm leading-6", muted ? "text-slate-400" : "text-slate-200")}>{value}</p>
    </div>
  );
});

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

const DecisionPanel = memo(function DecisionPanel({ data }: { data: ResearchData | null }) {
  const mcp = data?.mcp || {};
  const market = data?.market || {};
  const confidenceValue = Number.isFinite(Number(mcp.confidence)) ? Number(mcp.confidence) : 0;
  const tradeScoreValue = Number.isFinite(Number(mcp.trade_score)) ? Number(mcp.trade_score) : 0;
  const expectedMovePercent = Number.isFinite(Number(mcp.expected_move?.percent)) ? Number(mcp.expected_move?.percent) : null;
  const rrValue = Number.isFinite(Number(mcp.risk?.rr)) ? Number(mcp.risk?.rr) : null;

  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_45%),rgba(2,6,23,0.82)] p-5">
      <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-300/80">Decision</p>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className={cn("rounded-2xl border px-4 py-4", badgeTone(mcp.action))}>
          <p className="text-[10px] uppercase tracking-[0.22em] opacity-75">Action</p>
          <p className="mt-2 text-2xl font-semibold uppercase tracking-[0.14em]">{mcp.action || "AVOID"}</p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-4 text-slate-100">
          <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Trade Score</p>
          <p className="mt-2 text-3xl font-semibold">{Math.round(tradeScoreValue)}</p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-4 text-slate-100">
          <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Expected Move</p>
          <p className="mt-2 text-3xl font-semibold">{expectedMovePercent === null ? "--" : `${formatMetricNumber(expectedMovePercent, 1)}%`}</p>
          <p className={cn("mt-1 text-xs uppercase tracking-[0.18em]", badgeTone(mcp.expected_move?.label))}>{mcp.expected_move?.label || "LOW"}</p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-4 text-slate-100">
          <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">R:R</p>
          <p className="mt-2 text-3xl font-semibold">{formatRatio(rrValue)}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-300">
        <span className={cn("rounded-full border px-2.5 py-1", badgeTone(mcp.trade_quality))}>{mcp.trade_quality || "LOW"}</span>
        <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-slate-300">{formatCurrency(market.price ?? null)}</span>
        <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-slate-300">{formatPercent(market.change_percent ?? null)}</span>
      </div>
      <p className="mt-6 text-2xl font-semibold leading-9 text-slate-100">{normalizeMcpSummary(mcp.summary)}</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <InfoPanel title="Why" value={mcp.why || "No catalyst identified yet"} />
        <InfoPanel title="Trade Plan" value={mcp.when || "Waiting for better conditions"} />
      </div>
      <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Confidence</p>
        <p className="mt-2 text-sm leading-6 text-slate-200">{`${confidenceValue}% — ${mcp.confidence_reason || "Moderate conviction"}`}</p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div className={cn("h-full rounded-full transition-all", confidenceBarTone(confidenceValue))} style={{ width: `${Math.max(0, Math.min(100, confidenceValue))}%` }} />
        </div>
      </div>
    </div>
  );
});

const OverviewPanel = memo(function OverviewPanel({ data, symbol }: { data: ResearchData | null; symbol: string }) {
  const company = data?.company || {};
  const earnings = data?.earnings || {};

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Overview</p>
        <p className="mt-3 text-lg font-medium text-slate-100">{company.company_name || symbol}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <InfoPanel title="Sector" value={company.sector || "No data available"} muted />
          <InfoPanel title="Industry" value={company.industry || "No data available"} muted />
          <InfoPanel title="Exchange" value={company.exchange || "No data available"} muted />
          <InfoPanel title="Country" value={company.country || "No data available"} muted />
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-400">{company.description || "No data available"}</p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Earnings</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <InfoPanel title="Next Report" value={formatDate(earnings.next?.report_date)} muted />
          <InfoPanel title="Report Time" value={earnings.next?.report_time || "No data available"} muted />
          <InfoPanel title="EPS Estimate" value={Number.isFinite(Number(earnings.next?.eps_estimate)) ? Number(earnings.next?.eps_estimate).toFixed(2) : "No data available"} muted />
          <InfoPanel title="Revenue Estimate" value={formatLargeNumber(earnings.next?.revenue_estimate ?? null)} muted />
        </div>
      </div>
    </div>
  );
});

const FundamentalsPanel = memo(function FundamentalsPanel({ data }: { data: ResearchData | null }) {
  const market = data?.market || {};
  const technicals = data?.technicals || {};
  const mcp = data?.mcp || {};

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Fundamentals</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoPanel title="Price" value={formatCurrency(market.price ?? null)} muted />
        <InfoPanel title="Relative Volume" value={Number.isFinite(Number(market.relative_volume ?? technicals.relative_volume)) ? Number(market.relative_volume ?? technicals.relative_volume).toFixed(2) : "No data available"} muted />
        <InfoPanel title="Volume" value={formatLargeNumber(market.volume ?? null)} muted />
        <InfoPanel title="Market Cap" value={formatLargeNumber(market.market_cap ?? null)} muted />
        <InfoPanel title="RSI" value={Number.isFinite(Number(technicals.rsi)) ? Number(technicals.rsi).toFixed(2) : "No data available"} muted />
        <InfoPanel title="VWAP" value={formatCurrency(technicals.vwap ?? null)} muted />
        <InfoPanel title="ATR" value={formatCurrency(technicals.atr ?? null)} muted />
        <InfoPanel title="Where" value={mcp.where || "Key levels still forming"} muted />
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
  const payload = data?.data || null;
  const researchMeta = data?.meta || null;
  const chartRows = useMemo(() => getChartRows(payload?.chart), [payload?.chart]);

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
      return undefined;
    }

    let isMounted = true;

    async function loadResearch() {
      try {
        setLoading(true);
        setError(false);
        console.log("[RESEARCH FETCH START]", symbol);

        const res = await fetch(`/api/v2/research/${encodeURIComponent(symbol)}`, {
          cache: "no-store",
        });
        console.log("[RESEARCH FETCH RESPONSE STATUS]", res.status);

        const json = (await res.json()) as ResearchResponse;
        console.log("[RESEARCH FETCH JSON RAW]", json);
        console.log("[RESEARCH FETCH SUCCESS]", json);

        if (!res.ok || !json?.data) {
          throw new Error(json?.error || `Failed to load research for ${symbol}`);
        }

        if (isMounted) {
          console.log("[RESEARCH SET DATA]", json);
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        console.error("[RESEARCH FETCH ERROR]", err);
        if (isMounted) {
          setData(null);
          setError(true);
          setLoading(false);
        }
      }
    }

    void loadResearch();

    return () => {
      console.log("[RESEARCH CLEANUP]", symbol);
      isMounted = false;
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

      {researchMeta?.fallback ? (
        <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          Some data is temporarily limited due to high load
        </div>
      ) : null}

      {!error ? (
        <div className="mt-8 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <DecisionPanel data={payload} />
            <OverviewPanel data={payload} symbol={symbol} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <div className="space-y-3">
              <ChartEngine ticker={symbol} timeframe="daily" height={340} />
              {!chartRows?.length ? <EmptyState message="No chart data available" compact /> : null}
            </div>
            <CatalystPanel symbol={symbol} news={news ?? ([] as NewsItem[])} />
          </div>

          <FundamentalsPanel data={payload} />
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
