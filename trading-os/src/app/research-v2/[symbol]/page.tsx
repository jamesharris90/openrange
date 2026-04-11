"use client";

import {
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api/client";
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
  summary?: string | null;
  source?: string | null;
  url?: string | null;
  published_at?: string | null;
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

type ChartRow = Record<string, unknown>;

type ResearchData = {
  symbol: string;
  market?: MarketData;
  technicals?: TechnicalsData;
  chart?: {
    intraday?: ChartRow[];
    daily?: ChartRow[];
  };
  news?: NewsItem[];
  earnings?: {
    latest?: EarningsRecord | null;
    next?: EarningsRecord | null;
  };
  company?: CompanyData;
  mcp?: MCPData;
  warnings?: string[];
};

type TrustLevel = "COMPLETE" | "SUFFICIENT" | "LIMITED";

type CoverageStatus =
  | "HAS_DATA"
  | "PARTIAL_NEWS"
  | "PARTIAL_EARNINGS"
  | "NO_NEWS"
  | "NO_EARNINGS"
  | "STRUCTURALLY_UNSUPPORTED"
  | "LOW_QUALITY_TICKER"
  | "INACTIVE";

type DataTrustResponse = {
  ok?: boolean;
  trust?: {
    has_price?: boolean;
    has_daily?: boolean;
    has_news?: boolean;
    has_earnings?: boolean;
    is_trustworthy?: boolean;
    trust_level?: TrustLevel;
    price?: {
      source_label?: string | null;
      last_updated_label?: string | null;
    };
    daily?: {
      last_updated_label?: string | null;
    };
    news?: {
      count_7d?: number | null;
    };
    earnings?: {
      latest_report_date?: string | null;
    };
  };
};

type CoverageResponse = {
  ok?: boolean;
  coverage?: {
    status?: CoverageStatus;
    detail?: string;
    explanation?: string;
    metrics?: {
      news_count_7d?: number | null;
      news_count_30d?: number | null;
      earnings_upcoming_count?: number | null;
      earnings_history_count?: number | null;
      latest_report_date?: string | null;
      next_report_date?: string | null;
    };
  };
};

type ResearchResponse = {
  success?: boolean;
  data?: ResearchData;
  error?: string;
  meta?: {
    fallback?: boolean;
    reason?: string | null;
    response_ms?: number;
  };
};

type ChartTimeframe = "1m" | "daily";

type ChartPoint = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function toChartTime(value: unknown): UTCTimestamp | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value > 1_000_000_000_000 ? value / 1000 : value) as UTCTimestamp;
  }

  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.floor(parsed / 1000) as UTCTimestamp;
}

function normalizeChartRows(rows: ChartRow[] | undefined) {
  const byTime = new Map<number, ChartPoint>();

  for (const row of Array.isArray(rows) ? rows : []) {
    const time = toChartTime(row.time ?? row.timestamp ?? row.date ?? null);
    const close = Number(row.close ?? row.open ?? 0);
    const open = Number(row.open ?? row.close ?? close);
    const high = Number(row.high ?? row.close ?? close);
    const low = Number(row.low ?? row.close ?? close);
    const volume = Number(row.volume ?? 0);

    if (time === null || !Number.isFinite(close) || close <= 0) {
      continue;
    }

    byTime.set(Number(time), {
      time,
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }

  return Array.from(byTime.values()).sort((left, right) => Number(left.time) - Number(right.time));
}

function computeVWAP(rows: ChartPoint[]) {
  let cumulativePV = 0;
  let cumulativeVolume = 0;

  return rows.map((row) => {
    const typicalPrice = (row.high + row.low + row.close) / 3;
    cumulativePV += typicalPrice * row.volume;
    cumulativeVolume += row.volume;
    return cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : row.close;
  });
}

function formatChartTimeframe(value: ChartTimeframe) {
  return value === "1m" ? "1m intraday" : "daily";
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

function formatDateTime(value: string | null | undefined) {
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
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
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

function splitMultiline(value: string | undefined) {
  const lines = String(value || "Waiting for better conditions")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length ? lines : ["Waiting for better conditions"];
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

function getCoverageSummary(status: CoverageStatus | undefined) {
  switch (status) {
    case "HAS_DATA":
      return {
        label: "🟢 Full coverage",
        tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
      };
    case "PARTIAL_NEWS":
      return {
        label: "🟡 Limited news coverage",
        tone: "border-amber-500/30 bg-amber-500/10 text-amber-200",
      };
    case "PARTIAL_EARNINGS":
      return {
        label: "🟡 Partial earnings coverage",
        tone: "border-amber-500/30 bg-amber-500/10 text-amber-200",
      };
    case "NO_NEWS":
      return {
        label: "🟡 No recent news coverage",
        tone: "border-amber-500/30 bg-amber-500/10 text-amber-200",
      };
    case "NO_EARNINGS":
      return {
        label: "🔴 No earnings data available",
        tone: "border-rose-500/30 bg-rose-500/10 text-rose-200",
      };
    case "STRUCTURALLY_UNSUPPORTED":
      return {
        label: "🔴 Structurally unsupported",
        tone: "border-rose-500/30 bg-rose-500/10 text-rose-200",
      };
    case "LOW_QUALITY_TICKER":
      return {
        label: "🔴 Low market activity",
        tone: "border-rose-500/30 bg-rose-500/10 text-rose-200",
      };
    case "INACTIVE":
      return {
        label: "⚪ Inactive coverage",
        tone: "border-slate-500/30 bg-slate-500/10 text-slate-200",
      };
    default:
      return {
        label: "🔴 Coverage unavailable",
        tone: "border-rose-500/30 bg-rose-500/10 text-rose-200",
      };
  }
}

function InfoPanel({
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
}

function ResearchChart({
  symbol,
  currentPrice,
  chart,
}: {
  symbol: string;
  currentPrice: number | null;
  chart?: ResearchData["chart"];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [rows, setRows] = useState<ChartPoint[]>([]);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1m");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    console.log("CHART DATA:", chart);

    const intradayRows = normalizeChartRows(chart?.intraday);
    const dailyRows = normalizeChartRows(chart?.daily);
    const nextRows = intradayRows.length > 1 ? intradayRows : dailyRows;
    const nextTimeframe = intradayRows.length > 1 ? "1m" : "daily";

    if (nextRows.length > 1) {
      setRows(nextRows);
      setTimeframe(nextTimeframe);
      setStatus("ready");
    } else {
      setRows([]);
      setStatus("error");
    }
  }, [chart]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || rows.length === 0) {
      return;
    }

    const chartInstance = createChart(host, {
      width: host.clientWidth,
      height: 340,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(148,163,184,0.78)",
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.06)" },
        horzLines: { color: "rgba(148,163,184,0.06)" },
      },
      crosshair: {
        vertLine: { color: "rgba(59,130,246,0.45)" },
        horzLine: { color: "rgba(59,130,246,0.45)" },
      },
      timeScale: {
        borderColor: "rgba(148,163,184,0.12)",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: "rgba(148,163,184,0.12)",
        scaleMargins: { top: 0.08, bottom: 0.32 },
      },
    });

    const priceSeries = chartInstance.addSeries(LineSeries, {
      color: "#34d399",
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
    });
    const vwapSeries = chartInstance.addSeries(LineSeries, {
      color: "#60a5fa",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const volumeSeries = chartInstance.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.76, bottom: 0 },
    });

    const priceRows = rows.map((row) => ({ time: row.time, value: row.close }));
    const vwapValues = computeVWAP(rows);

    priceSeries.setData(priceRows);
    vwapSeries.setData(priceRows.map((row, index) => ({ time: row.time, value: vwapValues[index] ?? row.value })));
    volumeSeries.setData(
      rows.map((row) => ({
        time: row.time,
        value: row.volume,
        color: row.close >= row.open ? "rgba(52,211,153,0.38)" : "rgba(248,113,113,0.38)",
      }))
    );

    if (Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0) {
      priceSeries.createPriceLine({
        price: Number(currentPrice),
        color: "rgba(226,232,240,0.4)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "Last",
      });
    }

    chartInstance.timeScale().fitContent();
    chartRef.current = chartInstance;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      chartInstance.remove();
      chartRef.current = null;
    };
  }, [rows, currentPrice]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Chart</p>
          <p className="mt-2 text-sm text-slate-300">{symbol} · {formatChartTimeframe(timeframe)}</p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.16em] text-slate-500">
          <p>Unified API</p>
          <p className="mt-1">VWAP · Volume</p>
        </div>
      </div>
      {status === "loading" ? (
        <div className="mt-4 h-[340px] animate-pulse rounded-xl bg-slate-950/70" />
      ) : status === "error" ? (
        <div className="mt-4 flex h-[340px] items-center justify-center rounded-xl border border-slate-800 bg-slate-950/70 text-sm text-slate-500">
          No data available
        </div>
      ) : (
        <div ref={containerRef} className="mt-4 h-[340px] w-full" />
      )}
    </div>
  );
}

export default function ResearchV2SymbolPage({ params }: Props) {
  const symbol = params.symbol.toUpperCase();
  const [data, setData] = useState<ResearchData | null>(null);
  const [trust, setTrust] = useState<DataTrustResponse["trust"] | null>(null);
  const [coverage, setCoverage] = useState<CoverageResponse["coverage"] | null>(null);
  const [researchMeta, setResearchMeta] = useState<ResearchResponse["meta"] | null>(null);
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

        const payload = (await response.json()) as ResearchResponse;
        console.log("RESEARCH DATA:", payload?.data);

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || `Failed to load research for ${symbol}`);
        }

        if (!cancelled) {
          setData(payload.data);
          setResearchMeta(payload.meta || null);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load research");
          setData(null);
          setResearchMeta(null);
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

  useEffect(() => {
    let cancelled = false;

    async function loadCoverage() {
      try {
        const response = await apiFetch(`/api/system/data-coverage?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as CoverageResponse;

        if (!cancelled && response.ok) {
          setCoverage(payload.coverage || null);
        }
      } catch {
        if (!cancelled) {
          setCoverage(null);
        }
      }
    }

    loadCoverage();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;

    async function loadTrust() {
      try {
        const response = await apiFetch(`/api/system/data-trust?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as DataTrustResponse;

        if (!cancelled && response.ok) {
          setTrust(payload.trust || null);
        }
      } catch {
        if (!cancelled) {
          setTrust(null);
        }
      }
    }

    loadTrust();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const mcp = data?.mcp || {};
  const market = data?.market || {};
  const technicals = data?.technicals || {};
  const company = data?.company || {};
  const earnings = data?.earnings || {};
  const news = Array.isArray(data?.news) ? data.news.slice(0, 3) : [];
  const improveLines = splitMultiline(mcp.improve);
  const confidenceValue = Number.isFinite(Number(mcp.confidence)) ? Number(mcp.confidence) : 0;
  const tradeScoreValue = Number.isFinite(Number(mcp.trade_score)) ? Number(mcp.trade_score) : 0;
  const expectedMovePercent = Number.isFinite(Number(mcp.expected_move?.percent)) ? Number(mcp.expected_move?.percent) : null;
  const rrValue = Number.isFinite(Number(mcp.risk?.rr)) ? Number(mcp.risk?.rr) : null;
  const normalizedSummary = normalizeMcpSummary(mcp.summary);
  const coverageSummary = getCoverageSummary(coverage?.status);
  const hasLimitedNewsCoverage = ["PARTIAL_NEWS", "NO_NEWS"].includes(String(coverage?.status || ""));
  const dataAgeLabel = trust?.price?.last_updated_label || trust?.daily?.last_updated_label || "unknown";

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-8 text-slate-100 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-400/80">Research</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{symbol}</h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Unified research data with MCP-driven trade guidance, chart data, market context, and core company fields.
          </p>
        </div>
        <Link
          href="/screener-v2"
          className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
        >
          Back to Opportunities
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

      {!loading && !error && researchMeta?.fallback ? (
        <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          Some data is temporarily limited due to high load
        </div>
      ) : null}

      {!loading && !error && data ? (
        <div className="mt-8 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="rounded-2xl border border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_45%),rgba(2,6,23,0.82)] p-5">
              <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-300/80">What Should I Do?</p>
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
                <span className={cn("rounded-full border px-2.5 py-1", badgeTone(mcp.trade_quality))}>
                  {mcp.trade_quality || "LOW"}
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-slate-300">
                  {formatCurrency(market.price ?? null)}
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-slate-300">
                  {formatPercent(market.change_percent ?? null)}
                </span>
              </div>
              <p className="mt-6 text-2xl font-semibold leading-9 text-slate-100">{normalizedSummary}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <InfoPanel title="What" value={mcp.what || "Structure still developing"} />
              <InfoPanel title="Risk" value={`Entry ${formatCurrency(mcp.risk?.entry ?? null)} · Invalidation ${formatCurrency(mcp.risk?.invalidation ?? null)} · Reward ${formatCurrency(mcp.risk?.reward ?? null)}`} />
              <InfoPanel title="Where" value={mcp.where || "Key levels still forming"} />
            </div>
          </div>

          <ResearchChart symbol={symbol} currentPrice={market.price ?? null} chart={data.chart} />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="space-y-4">
              <InfoPanel title="Why" value={mcp.why || "No catalyst identified yet"} />
              <InfoPanel title="Trade Plan" value={mcp.when || "Waiting for better conditions"} />
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Data Coverage Detail</p>
                  <span
                    title="This reflects data availability, not quality"
                    className="cursor-help text-[10px] uppercase tracking-[0.18em] text-slate-500"
                  >
                    Coverage note
                  </span>
                </div>
                <div className={cn("mt-3 rounded-xl border px-3 py-3 text-sm font-medium", coverageSummary.tone)}>
                  {coverageSummary.label}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {coverage?.explanation || "Coverage explanation unavailable."}
                </p>
                <div className="mt-3 space-y-2 text-sm text-slate-200">
                  <div>Price: {trust?.has_price ? trust?.price?.source_label || "Available" : "Missing"}</div>
                  <div>Data age: {dataAgeLabel}</div>
                  <div>{trust?.has_daily ? "✅" : "❌"} Daily Data: {trust?.has_daily ? `Up to date · ${trust?.daily?.last_updated_label || "unknown"}` : "Stale or missing"}</div>
                  <div>{trust?.has_news ? "✅" : "⚠️"} News: {Number(coverage?.metrics?.news_count_7d || 0) > 0 ? `${coverage?.metrics?.news_count_7d || 0} articles in 7d` : "No recent coverage"}</div>
                  <div>{trust?.has_earnings ? "✅" : "❌"} Earnings: {coverage?.metrics?.next_report_date || coverage?.metrics?.latest_report_date ? `Next ${formatDate(coverage?.metrics?.next_report_date)} · Last ${formatDate(coverage?.metrics?.latest_report_date)}` : "No earnings data available"}</div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Improve</p>
                <div className="mt-2 space-y-2 text-sm leading-6 text-slate-200">
                  {improveLines.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Confidence</p>
                <p className="mt-2 text-sm leading-6 text-slate-200">{`${confidenceValue}% — ${mcp.confidence_reason || "Moderate conviction"}`}</p>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div className={cn("h-full rounded-full transition-all", confidenceBarTone(confidenceValue))} style={{ width: `${Math.max(0, Math.min(100, confidenceValue))}%` }} />
                </div>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Market Snapshot</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <InfoPanel title="Price" value={formatCurrency(market.price ?? null)} muted />
                  <InfoPanel title="Relative Volume" value={Number.isFinite(Number(market.relative_volume ?? technicals.relative_volume)) ? Number(market.relative_volume ?? technicals.relative_volume).toFixed(2) : "No data available"} muted />
                  <InfoPanel title="Volume" value={formatLargeNumber(market.volume ?? null)} muted />
                  <InfoPanel title="Market Cap" value={formatLargeNumber(market.market_cap ?? null)} muted />
                  <InfoPanel title="RSI" value={Number.isFinite(Number(technicals.rsi)) ? Number(technicals.rsi).toFixed(2) : "No data available"} muted />
                  <InfoPanel title="VWAP" value={formatCurrency(technicals.vwap ?? null)} muted />
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Company</p>
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

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Latest News</p>
            <div className="mt-4 space-y-3">
              {hasLimitedNewsCoverage ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                  Limited recent news coverage for this ticker.
                </div>
              ) : null}
              {news.length ? news.map((item) => (
                <div key={item.id || item.url || item.title} className="rounded-xl border border-slate-800/80 bg-slate-950/55 p-4">
                  <p className="text-sm font-medium text-slate-100">{item.title || "No data available"}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{item.summary || "No data available"}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span>{item.source || "No data available"}</span>
                    <span>{formatDateTime(item.published_at)}</span>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-slate-500">Limited recent news coverage for this ticker.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
