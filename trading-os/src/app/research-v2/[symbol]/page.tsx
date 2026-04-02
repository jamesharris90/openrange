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

function pickChartRows(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return [] as Array<Record<string, unknown>>;
  }

  const root = payload as { data?: unknown; candles?: unknown };
  if (Array.isArray(root.data)) {
    return root.data as Array<Record<string, unknown>>;
  }

  if (Array.isArray(root.candles)) {
    return root.candles as Array<Record<string, unknown>>;
  }

  return [] as Array<Record<string, unknown>>;
}

function normalizeChartRows(payload: unknown) {
  const byTime = new Map<number, ChartPoint>();

  for (const row of pickChartRows(payload)) {
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

  return [...byTime.values()].sort((left, right) => Number(left.time) - Number(right.time));
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

function buildSyntheticRows(price: number) {
  const now = Math.floor(Date.now() / 1000);
  const safePrice = Number.isFinite(price) && price > 0 ? price : 1;

  return [
    {
      time: (now - 3600) as UTCTimestamp,
      open: safePrice,
      high: safePrice,
      low: safePrice,
      close: safePrice,
      volume: 0,
    },
    {
      time: now as UTCTimestamp,
      open: safePrice,
      high: safePrice,
      low: safePrice,
      close: safePrice,
      volume: 0,
    },
  ] satisfies ChartPoint[];
}

function formatChartTimeframe(value: ChartTimeframe) {
  return value === "1m" ? "1m intraday" : "daily";
}

function ResearchChart({ symbol, currentPrice }: { symbol: string; currentPrice: number | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [rows, setRows] = useState<ChartPoint[]>([]);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1m");
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    let cancelled = false;

    async function loadChart() {
      setStatus("loading");

      const requests: Array<{ path: string; timeframe: ChartTimeframe }> = [
        { path: `/api/ohlc/intraday?symbol=${encodeURIComponent(symbol)}&interval=1m`, timeframe: "1m" },
        { path: `/api/market/ohlc?symbol=${encodeURIComponent(symbol)}&interval=1d`, timeframe: "daily" },
      ];

      for (const request of requests) {
        try {
          const response = await apiFetch(request.path, { cache: "no-store" });
          if (!response.ok) {
            continue;
          }

          const payload = await response.json();
          const nextRows = normalizeChartRows(payload);
          if (nextRows.length > 1) {
            if (!cancelled) {
              setRows(nextRows);
              setTimeframe(request.timeframe);
              setStatus("ready");
            }
            return;
          }
        } catch {
        }
      }

      if (!cancelled) {
        setRows(buildSyntheticRows(Number(currentPrice ?? 0)));
        setTimeframe("daily");
        setStatus("fallback");
      }
    }

    loadChart();
    return () => {
      cancelled = true;
    };
  }, [symbol, currentPrice]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host || rows.length === 0) {
      return;
    }

    const chart = createChart(host, {
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
        vertLine: { color: "rgba(59,130,246,0.45)", lineWidth: 1 },
        horzLine: { color: "rgba(59,130,246,0.45)", lineWidth: 1 },
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

    const priceSeries = chart.addSeries(LineSeries, {
      color: "#34d399",
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
    });
    const vwapSeries = chart.addSeries(LineSeries, {
      color: "#60a5fa",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
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

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
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
          <p>Price line</p>
          <p className="mt-1">VWAP · Volume</p>
        </div>
      </div>
      {status === "loading" ? (
        <div className="mt-4 h-[340px] animate-pulse rounded-xl bg-slate-950/70" />
      ) : (
        <>
          <div ref={containerRef} className="mt-4 h-[340px] w-full" />
          {status === "fallback" ? (
            <p className="mt-3 text-xs text-slate-500">Live candles were unavailable, so the chart fell back to the current price snapshot.</p>
          ) : null}
        </>
      )}
    </div>
  );
}

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
          <ResearchChart symbol={symbol} currentPrice={screener.price} />

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