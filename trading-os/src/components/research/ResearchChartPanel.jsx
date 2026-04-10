"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import ResearchIndicatorPanels from "@/components/research/ResearchIndicatorPanels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet } from "@/lib/api/client";
import { getCachedMarketMode } from "@/lib/marketMode";
import { QUERY_POLICY } from "@/lib/queries/policy";
import { cn } from "@/lib/utils";

import { WARMING_COPY, formatCompactNumber, formatCurrency, formatPercent } from "@/components/research/formatters";

const INTERVALS = [
  { id: "1min", label: "1m", intraday: true },
  { id: "5min", label: "5m", intraday: true },
  { id: "1day", label: "1D", intraday: false },
];

const CHART_MODES = [
  { id: "sparkline", label: "Sparkline" },
  { id: "candle", label: "Candle" },
];

const OVERLAY_DEFAULTS = {
  vwap: true,
  ema9: true,
  ema20: true,
};

function buildOffsetPath(values, width, plotHeight, min, max, offsetY) {
  if (!values.length) {
    return "";
  }

  const span = max - min || 1;

  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = offsetY + plotHeight - ((value - min) / span) * plotHeight;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildSeriesPath(values, getX, getY) {
  const parts = [];

  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      return;
    }

    parts.push(`${parts.length === 0 ? "M" : "L"}${getX(index).toFixed(2)},${getY(value).toFixed(2)}`);
  });

  return parts.join(" ");
}

function computeEMA(values, period) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const result = [];
  let emaValue = null;

  values.forEach((value) => {
    if (!Number.isFinite(value)) {
      result.push(null);
      return;
    }

    emaValue = emaValue === null ? value : ((value - emaValue) * multiplier) + emaValue;
    result.push(emaValue);
  });

  return result;
}

function computeVWAP(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  return points.map((point) => {
    const high = toFiniteNumber(point?.high);
    const low = toFiniteNumber(point?.low);
    const close = toFiniteNumber(point?.close);
    const volume = Math.max(0, toFiniteNumber(point?.volume) ?? 0);

    if (high === null || low === null || close === null) {
      return null;
    }

    const typicalPrice = (high + low + close) / 3;
    cumulativePriceVolume += typicalPrice * volume;
    cumulativeVolume += volume;

    return cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : close;
  });
}

function formatAxisPrice(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  if (Math.abs(value) >= 1000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  return value.toFixed(value >= 100 ? 1 : 2);
}

function formatAxisTime(value) {
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000)
    : new Date(String(value || ""));

  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }

  const isMidnight = parsed.getHours() === 0 && parsed.getMinutes() === 0;
  return parsed.toLocaleString("en-US", isMidnight
    ? { month: "short", day: "numeric" }
    : { hour: "numeric", minute: "2-digit" });
}

function buildOverlayRows(series, indicatorRows = [], { enableVwapFallback = true } = {}) {
  const indicatorByTime = new Map((Array.isArray(indicatorRows) ? indicatorRows : [])
    .map((row) => [Number(row?.time), row])
    .filter(([time]) => Number.isFinite(time)));
  const closes = series.map((point) => toFiniteNumber(point?.close));
  const ema9Fallback = computeEMA(closes, 9);
  const ema20Fallback = computeEMA(closes, 20);
  const vwapFallback = enableVwapFallback ? computeVWAP(series) : [];

  return series.map((point, index) => {
    const indicatorRow = indicatorByTime.get(Number(point?.time)) || {};
    return {
      time: point.time,
      vwap: toFiniteNumber(indicatorRow?.vwap) ?? vwapFallback[index] ?? null,
      ema9: toFiniteNumber(indicatorRow?.ema9) ?? ema9Fallback[index] ?? point.close,
      ema20: toFiniteNumber(indicatorRow?.ema20) ?? ema20Fallback[index] ?? point.close,
    };
  });
}

function normalizeChartPoints(points) {
  return (Array.isArray(points) ? points : [])
    .map((point) => {
      const open = Number(point?.open ?? point?.close);
      const high = Number(point?.high ?? point?.close);
      const low = Number(point?.low ?? point?.close);
      const close = Number(point?.close);
      const volume = Number(point?.volume ?? 0);
      const time = point?.time ?? null;

      if (![open, high, low, close].every(Number.isFinite) || time === null || time === undefined) {
        return null;
      }

      const hasValidPrices = open > 0 && high > 0 && low > 0 && close > 0;
      const hasConsistentRange = high >= Math.max(open, close, low) && low <= Math.min(open, close, high);
      if (!hasValidPrices || !hasConsistentRange) {
        return null;
      }

      return { open, high, low, close, volume, time };
    })
    .filter(Boolean);
}

function formatTimeLabel(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value > 1_000_000_000_000 ? value : value * 1000);
    if (!Number.isNaN(parsed.getTime())) {
      const isMidnight = parsed.getHours() === 0 && parsed.getMinutes() === 0;
      return parsed.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        ...(isMidnight ? {} : { hour: "numeric", minute: "2-digit" }),
      });
    }
  }

  const parsed = new Date(String(value || ""));
  if (!Number.isNaN(parsed.getTime())) {
    const isMidnight = parsed.getHours() === 0 && parsed.getMinutes() === 0;
    return parsed.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      ...(isMidnight ? {} : { hour: "numeric", minute: "2-digit" }),
    });
  }

  return WARMING_COPY;
}


function findIndexByTime(points, hoverTime) {
  const target = Number(hoverTime);
  if (!Number.isFinite(target) || !Array.isArray(points) || points.length === 0) {
    return null;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const candidate = Number(points[index]?.time);
    if (!Number.isFinite(candidate)) {
      continue;
    }
    const distance = Math.abs(candidate - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageBarRangePercent(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const values = points
    .map((point) => {
      if (!point || !Number.isFinite(point.high) || !Number.isFinite(point.low) || !Number.isFinite(point.close) || point.close === 0) {
        return null;
      }

      return ((point.high - point.low) / point.close) * 100;
    })
    .filter((value) => Number.isFinite(value));

  return average(values);
}

async function fetchChartWithFallback(symbol, interval) {
  const primary = await apiGet(`/api/v5/chart?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`)
    .catch(() => null);

  const primaryCandles = Array.isArray(primary?.candles) ? primary.candles : [];
  const primaryDaily = Array.isArray(primary?.dailyCandles) ? primary.dailyCandles : [];

  if (primaryCandles.length > 0) {
    return { points: primaryCandles, fallbackMode: false, source: interval };
  }

  if (primaryDaily.length > 0) {
    return { points: primaryDaily.slice(-60), fallbackMode: true, source: "sparkline" };
  }

  const daily = await apiGet(`/api/v5/chart?symbol=${encodeURIComponent(symbol)}&interval=1day`).catch(() => null);
  const dailyCandles = Array.isArray(daily?.candles) ? daily.candles : [];
  const dailySeries = dailyCandles.length > 0 ? dailyCandles : (Array.isArray(daily?.dailyCandles) ? daily.dailyCandles : []);

  if (dailySeries.length > 0) {
    return {
      points: interval === "1day" ? dailySeries : dailySeries.slice(-60),
      fallbackMode: interval !== "1day",
      source: interval === "1day" ? "1day" : "sparkline",
    };
  }

  return { points: [], fallbackMode: true, source: "empty" };
}

function InteractiveChart({
  points,
  indicatorRows,
  overlays,
  interval,
  chartMode,
  stats,
  marketMode,
  hoverTime,
  onHoverTimeChange,
  showExtendedStats,
  setShowExtendedStats,
}) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const normalized = useMemo(() => normalizeChartPoints(points), [points]);
  const series = normalized;
  const sessionVwapEnabled = overlays.vwap && interval !== "1day";
  const overlayRows = useMemo(
    () => buildOverlayRows(series, indicatorRows, { enableVwapFallback: sessionVwapEnabled }),
    [indicatorRows, series, sessionVwapEnabled]
  );
  const closes = series.map((point) => point.close);
  const first = closes[0];
  const last = closes[closes.length - 1];
  const candleMin = series.length ? Math.min(...series.map((point) => point.low)) : null;
  const candleMax = series.length ? Math.max(...series.map((point) => point.high)) : null;
  const overlayValues = overlayRows.flatMap((row) => [
    sessionVwapEnabled ? row.vwap : null,
    overlays.ema9 ? row.ema9 : null,
    overlays.ema20 ? row.ema20 : null,
  ]).filter((value) => Number.isFinite(value));
  const deltaPercent = first ? ((last - first) / first) * 100 : 0;
  const stroke = deltaPercent >= 0 ? "#34d399" : "#fb7185";
  const syncedIndex = hoveredIndex ?? findIndexByTime(series, hoverTime);
  const activeIndex = syncedIndex ?? Math.max(0, series.length - 1);
  const activePoint = series[activeIndex] || null;
  const width = 880;
  const height = 320;
  const plotTop = 18;
  const plotBottom = 34;
  const plotLeft = 14;
  const plotRight = 62;
  const plotWidth = width - plotLeft - plotRight;
  const plotHeight = height - plotTop - plotBottom;
  const rawRangeMin = [candleMin, ...overlayValues].filter((value) => Number.isFinite(value));
  const rawRangeMax = [candleMax, ...overlayValues].filter((value) => Number.isFinite(value));
  const baseMin = rawRangeMin.length ? Math.min(...rawRangeMin) : 0;
  const baseMax = rawRangeMax.length ? Math.max(...rawRangeMax) : 1;
  const baseSpan = baseMax - baseMin || Math.max(Math.abs(baseMax) * 0.02, 1);
  const padding = baseSpan * 0.06;
  const rangeMin = baseMin - padding;
  const rangeMax = baseMax + padding;
  const span = rangeMax - rangeMin || 1;
  const path = buildOffsetPath(closes, plotWidth, plotHeight, rangeMin, rangeMax, plotTop).replace(/([ML])(\d+(?:\.\d+)?),/g, (_match, command, x) => `${command}${(Number(x) + plotLeft).toFixed(2)},`);
  const averageRangePercent = averageBarRangePercent(series);
  const getX = (index) => plotLeft + (series.length <= 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);
  const getY = (value) => plotTop + plotHeight - ((value - rangeMin) / span) * plotHeight;
  const vwapPath = buildSeriesPath(overlayRows.map((row) => row.vwap), getX, getY);
  const ema9Path = buildSeriesPath(overlayRows.map((row) => row.ema9), getX, getY);
  const ema20Path = buildSeriesPath(overlayRows.map((row) => row.ema20), getX, getY);
  const yAxisValues = [1, 0.75, 0.5, 0.25, 0].map((ratio) => rangeMin + (span * ratio));
  const xAxisIndices = Array.from(new Set([0, Math.floor((series.length - 1) * 0.25), Math.floor((series.length - 1) * 0.5), Math.floor((series.length - 1) * 0.75), Math.max(series.length - 1, 0)]))
    .filter((index) => index >= 0 && index < series.length);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-800/70 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.92))] p-4">
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-800/80 pb-3">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white">
            {activePoint ? formatTimeLabel(activePoint.time) : WARMING_COPY}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-white">
            <span>O {formatCurrency(activePoint?.open ?? null)}</span>
            <span>H {formatCurrency(activePoint?.high ?? null)}</span>
            <span>L {formatCurrency(activePoint?.low ?? null)}</span>
            <span>C {formatCurrency(activePoint?.close ?? null)}</span>
          </div>
        </div>

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[320px] w-full overflow-visible"
          onMouseLeave={() => {
            setHoveredIndex(null);
            onHoverTimeChange?.(null);
          }}
        >
          <defs>
            <linearGradient id="research-terminal-chart-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {[0.15, 0.4, 0.65, 0.9].map((ratio) => (
            <line
              key={ratio}
              x1={plotLeft}
              x2={plotLeft + plotWidth}
              y1={plotTop + plotHeight * ratio}
              y2={plotTop + plotHeight * ratio}
              stroke="rgba(51,65,85,0.7)"
              strokeWidth="1"
            />
          ))}

          <line x1={plotLeft} x2={plotLeft + plotWidth} y1={plotTop + plotHeight} y2={plotTop + plotHeight} stroke="rgba(51,65,85,0.8)" strokeWidth="1" />
          <line x1={plotLeft + plotWidth} x2={plotLeft + plotWidth} y1={plotTop} y2={plotTop + plotHeight} stroke="rgba(51,65,85,0.8)" strokeWidth="1" />

          {chartMode === "sparkline" ? (
            <>
              <path d={`${path} L${plotLeft + plotWidth},${plotTop + plotHeight} L${plotLeft},${plotTop + plotHeight} Z`} fill="url(#research-terminal-chart-fill)" opacity="0.55" />
              <path d={path} fill="none" stroke={stroke} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            </>
          ) : (
            series.map((point, index) => {
              const x = getX(index);
              const openY = getY(point.open);
              const closeY = getY(point.close);
              const highY = getY(point.high);
              const lowY = getY(point.low);
              const candleTop = Math.min(openY, closeY);
              const candleHeight = Math.max(2, Math.abs(closeY - openY));
              const isUp = point.close >= point.open;
              const candleGap = Math.max(2, Math.floor(plotWidth / Math.max(series.length, 1) * 0.18));
              const candleWidth = Math.max(4, Math.min(12, plotWidth / Math.max(series.length, 1) - candleGap));

              return (
                <g key={`${point.time}-${index}`}>
                  <line x1={x} x2={x} y1={highY} y2={lowY} stroke={isUp ? "#5eead4" : "#fda4af"} strokeWidth="2" opacity="0.95" />
                  <rect
                    x={x - candleWidth / 2}
                    y={candleTop}
                    width={candleWidth}
                    height={candleHeight}
                    rx="2"
                    fill={isUp ? "#2dd4bf" : "#fb7185"}
                    opacity={0.96}
                  />
                </g>
              );
            })
          )}

          {sessionVwapEnabled && vwapPath ? <path d={vwapPath} fill="none" stroke="#60a5fa" strokeWidth="1.8" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" /> : null}
          {overlays.ema9 && ema9Path ? <path d={ema9Path} fill="none" stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /> : null}
          {overlays.ema20 && ema20Path ? <path d={ema20Path} fill="none" stroke="#c084fc" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /> : null}

          {syncedIndex !== null && activePoint ? (
            <>
              <line
                x1={getX(activeIndex)}
                x2={getX(activeIndex)}
                y1={plotTop}
                y2={plotTop + plotHeight}
                stroke="rgba(148,163,184,0.5)"
                strokeDasharray="4 4"
              />
              <line
                x1={plotLeft}
                x2={plotLeft + plotWidth}
                y1={getY(activePoint.close)}
                y2={getY(activePoint.close)}
                stroke="rgba(71,85,105,0.45)"
                strokeDasharray="4 4"
              />
              <circle
                cx={getX(activeIndex)}
                cy={getY(activePoint.close)}
                r="5"
                fill={stroke}
                stroke="rgba(15,23,42,0.95)"
                strokeWidth="2"
              />
            </>
          ) : null}

          {series.map((point, index) => {
            const previousX = index === 0 ? 0 : (getX(index - 1) + getX(index)) / 2;
            const nextX = index === series.length - 1 ? width : (getX(index) + getX(index + 1)) / 2;

            return (
              <rect
                key={`hover-${point.time}-${index}`}
                x={previousX}
                y="0"
                width={Math.max(8, nextX - previousX)}
                height={height}
                fill="transparent"
                onMouseEnter={() => {
                  setHoveredIndex(index);
                  onHoverTimeChange?.(point.time);
                }}
                onMouseMove={() => {
                  setHoveredIndex(index);
                  onHoverTimeChange?.(point.time);
                }}
              />
            );
          })}

          {yAxisValues.map((value) => (
            <text
              key={`y-axis-${value}`}
              x={plotLeft + plotWidth + 8}
              y={getY(value) + 4}
              fill="rgba(148,163,184,0.8)"
              fontSize="11"
            >
              {formatAxisPrice(value)}
            </text>
          ))}

          {xAxisIndices.map((index) => (
            <text
              key={`x-axis-${index}`}
              x={getX(index)}
              y={height - 8}
              fill="rgba(148,163,184,0.72)"
              fontSize="11"
              textAnchor={index === 0 ? "start" : index === series.length - 1 ? "end" : "middle"}
            >
              {formatAxisTime(series[index]?.time)}
            </text>
          ))}
        </svg>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-slate-500">
          <span className="rounded-full border border-slate-800/80 bg-slate-950/70 px-2.5 py-1">X Axis: Time</span>
          <span className="rounded-full border border-slate-800/80 bg-slate-950/70 px-2.5 py-1">Y Axis: Price</span>
          {sessionVwapEnabled ? <span className="text-sky-300">VWAP</span> : null}
          {overlays.ema9 ? <span className="text-amber-300">EMA 9</span> : null}
          {overlays.ema20 ? <span className="text-violet-300">EMA 20</span> : null}
          {interval === "1day" ? <span className="text-slate-400">VWAP hidden on 1D</span> : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">52W Low</div>
          <div className="mt-2 text-xl font-semibold text-slate-100">{formatCurrency(stats?.low52w ?? null)}</div>
        </div>
        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">52W High</div>
          <div className="mt-2 text-xl font-semibold text-slate-100">{formatCurrency(stats?.high52w ?? null)}</div>
        </div>
        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Latest Volume 1D</div>
          <div className="mt-2 text-xl font-semibold text-slate-100">{formatCompactNumber(stats?.latestVolume1D ?? null)}</div>
          <div className="mt-1 text-xs text-slate-500">{marketMode?.mode === "LIVE" ? "Live session daily volume" : "Latest daily close volume"}</div>
        </div>
        <button
          type="button"
          onClick={() => setShowExtendedStats((current) => !current)}
          className="rounded-2xl border border-slate-800/70 bg-slate-950/45 px-4 py-3 text-left transition hover:border-slate-700/90 hover:bg-slate-900/60"
        >
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Chart Stats</div>
          <div className="mt-2 text-sm font-semibold text-slate-100">{showExtendedStats ? "Hide more" : "Show more"}</div>
          <div className="mt-1 text-xs text-slate-500">Advanced range and debug-adjacent metrics</div>
        </button>
      </div>

      {showExtendedStats ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Avg Weekly Move</div>
            <div className="mt-2 text-xl font-semibold text-slate-100">{formatPercent(stats?.averageWeeklyMove ?? null, 2)}</div>
          </div>
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Visible Range</div>
            <div className="mt-2 text-xl font-semibold text-slate-100">{formatCurrency(rangeMin)} - {formatCurrency(rangeMax)}</div>
          </div>
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Return</div>
            <div className={cn("mt-2 text-xl font-semibold", deltaPercent >= 0 ? "text-emerald-300" : "text-rose-300")}>{formatPercent(deltaPercent)}</div>
          </div>
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Avg Bar Range</div>
            <div className="mt-2 text-xl font-semibold text-slate-100">{formatPercent(averageRangePercent ?? null, 2)}</div>
          </div>
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Bars Rendered</div>
            <div className="mt-2 text-xl font-semibold text-slate-100">{series.length ? series.length.toLocaleString("en-US") : "—"}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ResearchChartPanel({ symbol, indicators = null, showPanels = false, interval: controlledInterval, onIntervalChange, hoverTime = null, onHoverTimeChange }) {
  const [localInterval, setLocalInterval] = useState("1day");
  const [chartMode, setChartMode] = useState("sparkline");
  const [overlays, setOverlays] = useState(OVERLAY_DEFAULTS);
  const [showExtendedStats, setShowExtendedStats] = useState(false);
  const marketMode = getCachedMarketMode();
  const interval = controlledInterval ?? localInterval;
  const updateInterval = onIntervalChange ?? setLocalInterval;

  const chartQuery = useQuery({
    queryKey: ["slow", "researchTerminalChart", symbol, interval],
    queryFn: () => fetchChartWithFallback(symbol, interval),
    enabled: Boolean(symbol),
    ...QUERY_POLICY.fast,
  });

  const dailyChartQuery = useQuery({
    queryKey: ["slow", "researchTerminalChart", symbol, "1day", "metrics"],
    queryFn: () => fetchChartWithFallback(symbol, "1day"),
    enabled: Boolean(symbol),
    ...QUERY_POLICY.fast,
  });

  const points = Array.isArray(chartQuery.data?.points) ? chartQuery.data.points : [];
  const normalizedDaily = useMemo(() => {
    const dailyPoints = Array.isArray(dailyChartQuery.data?.points) ? dailyChartQuery.data.points : [];
    return normalizeChartPoints(dailyPoints);
  }, [dailyChartQuery.data?.points]);
  const indicatorRows = Array.isArray(indicators?.panels?.[interval]) ? indicators.panels[interval] : [];

  const chartStats = useMemo(() => {
    const trailingYear = normalizedDaily.slice(-252);
    const last60Days = normalizedDaily.slice(-60);
    const weeklyMoves = [];

    for (let index = 5; index < last60Days.length; index += 1) {
      const current = last60Days[index];
      const prior = last60Days[index - 5];
      if (!current || !prior || !Number.isFinite(current.close) || !Number.isFinite(prior.close) || prior.close === 0) {
        continue;
      }

      weeklyMoves.push(Math.abs(((current.close - prior.close) / prior.close) * 100));
    }

    const latestDaily = normalizedDaily[normalizedDaily.length - 1] || null;

    return {
      high52w: trailingYear.length ? Math.max(...trailingYear.map((point) => point.high)) : null,
      low52w: trailingYear.length ? Math.min(...trailingYear.map((point) => point.low)) : null,
      averageWeeklyMove: average(weeklyMoves),
      latestVolume1D: latestDaily?.volume ?? null,
    };
  }, [normalizedDaily]);
  const effectiveOverlays = useMemo(() => ({
    ...overlays,
    vwap: interval !== "1day" && overlays.vwap,
  }), [interval, overlays]);

  return (
    <Card className="border-slate-800/80 bg-slate-950/50">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Chart</CardTitle>
          <CardDescription>
            Clean overlays on the main chart, with optional indicator panels stacked below and synced to the same cursor.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {CHART_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setChartMode(mode.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                chartMode === mode.id
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                  : "border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              )}
            >
              {mode.label}
            </button>
          ))}
          {INTERVALS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => updateInterval(item.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                interval === item.id
                  ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-200"
                  : "border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              )}
            >
              {item.label}
            </button>
          ))}
          {[
            ["vwap", "VWAP"],
            ["ema9", "EMA 9"],
            ["ema20", "EMA 20"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={key === "vwap" && interval === "1day"}
              onClick={() => setOverlays((current) => ({ ...current, [key]: !current[key] }))}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                key === "vwap" && interval === "1day"
                  ? "cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600"
                  : overlays[key]
                  ? "border-sky-500/50 bg-sky-500/10 text-sky-100"
                  : "border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {chartQuery.isLoading && points.length === 0 ? (
          <div className="h-[360px] animate-pulse rounded-3xl border border-slate-800/70 bg-slate-900/50" />
        ) : points.length > 0 ? (
          <div className="space-y-4">
            <InteractiveChart
              points={points}
              indicatorRows={indicatorRows}
              overlays={effectiveOverlays}
              interval={interval}
              chartMode={chartMode}
              stats={chartStats}
              marketMode={marketMode}
              hoverTime={hoverTime}
              onHoverTimeChange={onHoverTimeChange}
              showExtendedStats={showExtendedStats}
              setShowExtendedStats={setShowExtendedStats}
            />
            {showPanels ? (
              <ResearchIndicatorPanels
                indicators={indicators}
                interval={interval}
                hoverTime={hoverTime}
                onHoverTimeChange={onHoverTimeChange}
              />
            ) : null}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-950/45 px-4 py-10 text-center text-sm text-slate-400">
            Decision view is showing only cached fundamentals while the chart cache rebuilds.
          </div>
        )}
      </CardContent>
    </Card>
  );
}