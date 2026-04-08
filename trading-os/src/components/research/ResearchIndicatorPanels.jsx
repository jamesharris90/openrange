"use client";

import { useMemo, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { WARMING_COPY, formatCompactNumber, formatCurrency } from "@/components/research/formatters";

const WIDTH = 820;
const PANEL_HEIGHT = 132;
const PLOT_TOP = 14;
const PLOT_BOTTOM = 16;

function toSeries(rows) {
  return Array.isArray(rows) ? rows.filter((row) => row && row.time != null) : [];
}

function nearestIndexByTime(series, hoverTime) {
  const target = Number(hoverTime);
  if (!Number.isFinite(target) || !series.length) {
    return null;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < series.length; index += 1) {
    const candidate = Number(series[index]?.time);
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

function buildLinePath(series, accessor, min, max) {
  const plotHeight = PANEL_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
  const span = max - min || 1;

  return series.map((row, index) => {
    const value = Number(accessor(row));
    if (!Number.isFinite(value)) {
      return null;
    }
    const x = series.length <= 1 ? WIDTH / 2 : (index / (series.length - 1)) * WIDTH;
    const y = PLOT_TOP + plotHeight - ((value - min) / span) * plotHeight;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).filter(Boolean).join(" ");
}

function computeRsi(values, period = 14) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const result = Array(values.length).fill(null);
  if (values.length <= period) {
    return result;
  }

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const current = Number(values[index]);
    const previous = Number(values[index - 1]);
    if (!Number.isFinite(current) || !Number.isFinite(previous)) {
      continue;
    }

    const delta = current - previous;
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - (100 / (1 + (avgGain / avgLoss)));

  for (let index = period + 1; index < values.length; index += 1) {
    const current = Number(values[index]);
    const previous = Number(values[index - 1]);
    if (!Number.isFinite(current) || !Number.isFinite(previous)) {
      result[index] = result[index - 1] ?? null;
      continue;
    }

    const delta = current - previous;
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    result[index] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - (100 / (1 + (avgGain / avgLoss)));
  }

  return result;
}

function formatTimeLabel(value) {
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000)
    : new Date(String(value || ""));

  if (Number.isNaN(parsed.getTime())) {
    return WARMING_COPY;
  }

  const isMidnight = parsed.getHours() === 0 && parsed.getMinutes() === 0;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(isMidnight ? {} : { hour: "numeric", minute: "2-digit" }),
  });
}

function ToggleButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        active
          ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-100"
          : "border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-200"
      )}
    >
      {children}
    </button>
  );
}

function VolumePanel({ series, hoverTime, onHoverTimeChange }) {
  const activeIndex = nearestIndexByTime(series, hoverTime) ?? Math.max(0, series.length - 1);
  const active = series[activeIndex] || null;
  const maxVolume = Math.max(...series.map((row) => Number(row?.volume) || 0), 1);
  const plotHeight = PANEL_HEIGHT - PLOT_TOP - PLOT_BOTTOM;

  return (
    <Card className="border-slate-800/80 bg-slate-950/50">
      <CardHeader>
        <CardTitle>Volume Panel</CardTitle>
        <CardDescription>Intraday or daily volume aligned with the main chart interval.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm text-slate-300">
          <span>{active ? formatTimeLabel(active.time) : WARMING_COPY}</span>
          <span>{formatCompactNumber(active?.volume ?? null)}</span>
        </div>
        <svg viewBox={`0 0 ${WIDTH} ${PANEL_HEIGHT}`} className="h-[150px] w-full overflow-visible" onMouseLeave={() => onHoverTimeChange?.(null)}>
          {series.map((row, index) => {
            const value = Number(row?.volume) || 0;
            const x = series.length <= 1 ? WIDTH / 2 : (index / (series.length - 1)) * WIDTH;
            const height = (value / maxVolume) * plotHeight;
            const y = PLOT_TOP + plotHeight - height;
            const previousClose = Number(series[index - 1]?.close);
            const currentClose = Number(row?.close);
            const fill = Number.isFinite(previousClose) && Number.isFinite(currentClose) && currentClose < previousClose
              ? "rgba(251,113,133,0.75)"
              : "rgba(34,197,94,0.75)";
            const prevX = index === 0 ? 0 : (x + ((index - 1) / Math.max(series.length - 1, 1)) * WIDTH) / 2;
            const nextX = index === series.length - 1 ? WIDTH : (x + (((index + 1) / Math.max(series.length - 1, 1)) * WIDTH)) / 2;
            const barWidth = Math.max(4, nextX - prevX - 1);

            return (
              <g key={`volume-${row.time}`}>
                <rect x={Math.max(0, x - barWidth / 2)} y={y} width={barWidth} height={Math.max(2, height)} rx="2" fill={fill} />
                <rect
                  x={prevX}
                  y="0"
                  width={Math.max(8, nextX - prevX)}
                  height={PANEL_HEIGHT}
                  fill="transparent"
                  onMouseEnter={() => onHoverTimeChange?.(row.time)}
                  onMouseMove={() => onHoverTimeChange?.(row.time)}
                />
              </g>
            );
          })}

          {active ? (
            <line
              x1={series.length <= 1 ? WIDTH / 2 : (activeIndex / (series.length - 1)) * WIDTH}
              x2={series.length <= 1 ? WIDTH / 2 : (activeIndex / (series.length - 1)) * WIDTH}
              y1={PLOT_TOP}
              y2={PLOT_TOP + plotHeight}
              stroke="rgba(148,163,184,0.55)"
              strokeDasharray="4 4"
            />
          ) : null}
        </svg>
      </CardContent>
    </Card>
  );
}

function MacdPanel({ series, hoverTime, onHoverTimeChange }) {
  const activeIndex = nearestIndexByTime(series, hoverTime) ?? Math.max(0, series.length - 1);
  const active = series[activeIndex] || null;
  const values = series.flatMap((row) => [Number(row?.macd), Number(row?.signal), Number(row?.histogram)]).filter(Number.isFinite);
  const min = values.length ? Math.min(...values, 0) : -1;
  const max = values.length ? Math.max(...values, 0) : 1;
  const plotHeight = PANEL_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
  const span = max - min || 1;
  const zeroY = PLOT_TOP + plotHeight - ((0 - min) / span) * plotHeight;
  const macdPath = buildLinePath(series, (row) => row.macd, min, max);
  const signalPath = buildLinePath(series, (row) => row.signal, min, max);

  return (
    <Card className="border-slate-800/80 bg-slate-950/50">
      <CardHeader>
        <CardTitle>MACD Panel</CardTitle>
        <CardDescription>MACD histogram with MACD and signal lines aligned to the chart interval.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
          <span>{active ? formatTimeLabel(active.time) : WARMING_COPY}</span>
          <div className="flex gap-4">
            <span>MACD {formatCurrency(active?.macd ?? null)}</span>
            <span>Signal {formatCurrency(active?.signal ?? null)}</span>
            <span>Hist {formatCurrency(active?.histogram ?? null)}</span>
          </div>
        </div>
        <svg viewBox={`0 0 ${WIDTH} ${PANEL_HEIGHT}`} className="h-[160px] w-full overflow-visible" onMouseLeave={() => onHoverTimeChange?.(null)}>
          <line x1="0" x2={WIDTH} y1={zeroY} y2={zeroY} stroke="rgba(71,85,105,0.8)" strokeWidth="1" />

          {series.map((row, index) => {
            const histogram = Number(row?.histogram) || 0;
            const x = series.length <= 1 ? WIDTH / 2 : (index / (series.length - 1)) * WIDTH;
            const y = PLOT_TOP + plotHeight - ((histogram - min) / span) * plotHeight;
            const prevX = index === 0 ? 0 : (x + ((index - 1) / Math.max(series.length - 1, 1)) * WIDTH) / 2;
            const nextX = index === series.length - 1 ? WIDTH : (x + (((index + 1) / Math.max(series.length - 1, 1)) * WIDTH)) / 2;
            const barWidth = Math.max(4, nextX - prevX - 1);

            return (
              <g key={`macd-hist-${row.time}`}>
                <rect
                  x={Math.max(0, x - barWidth / 2)}
                  y={Math.min(y, zeroY)}
                  width={barWidth}
                  height={Math.max(2, Math.abs(zeroY - y))}
                  rx="2"
                  fill={histogram >= 0 ? "rgba(34,197,94,0.68)" : "rgba(251,113,133,0.68)"}
                />
                <rect
                  x={prevX}
                  y="0"
                  width={Math.max(8, nextX - prevX)}
                  height={PANEL_HEIGHT}
                  fill="transparent"
                  onMouseEnter={() => onHoverTimeChange?.(row.time)}
                  onMouseMove={() => onHoverTimeChange?.(row.time)}
                />
              </g>
            );
          })}

          <path d={macdPath} fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d={signalPath} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {active ? (
            <line
              x1={series.length <= 1 ? WIDTH / 2 : (activeIndex / (series.length - 1)) * WIDTH}
              x2={series.length <= 1 ? WIDTH / 2 : (activeIndex / (series.length - 1)) * WIDTH}
              y1={PLOT_TOP}
              y2={PLOT_TOP + plotHeight}
              stroke="rgba(148,163,184,0.55)"
              strokeDasharray="4 4"
            />
          ) : null}
        </svg>
      </CardContent>
    </Card>
  );
}

function RsiPanel({ series, hoverTime, onHoverTimeChange }) {
  const activeIndex = nearestIndexByTime(series, hoverTime) ?? Math.max(0, series.length - 1);
  const active = series[activeIndex] || null;
  const min = 0;
  const max = 100;
  const plotHeight = PANEL_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
  const span = max - min || 1;
  const rsiPath = buildLinePath(series, (row) => row.rsi, min, max);

  const getY = (value) => PLOT_TOP + plotHeight - ((value - min) / span) * plotHeight;

  return (
    <Card className="border-slate-800/80 bg-slate-950/50">
      <CardHeader>
        <CardTitle>RSI Panel</CardTitle>
        <CardDescription>RSI 14 is plotted below the chart without taking space from the main price view.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
          <span>{active ? formatTimeLabel(active.time) : WARMING_COPY}</span>
          <div className="flex gap-4">
            <span>RSI {Number.isFinite(Number(active?.rsi)) ? Number(active.rsi).toFixed(2) : "--"}</span>
            <span>{Number(active?.rsi) >= 70 ? "Overbought" : Number(active?.rsi) <= 30 ? "Oversold" : "Neutral"}</span>
          </div>
        </div>
        <svg viewBox={`0 0 ${WIDTH} ${PANEL_HEIGHT}`} className="h-[160px] w-full overflow-visible" onMouseLeave={() => onHoverTimeChange?.(null)}>
          {[30, 50, 70].map((level) => (
            <line
              key={`rsi-${level}`}
              x1="0"
              x2={WIDTH}
              y1={getY(level)}
              y2={getY(level)}
              stroke={level === 50 ? "rgba(71,85,105,0.85)" : "rgba(245,158,11,0.45)"}
              strokeDasharray={level === 50 ? "4 4" : "6 4"}
              strokeWidth="1"
            />
          ))}

          <path d={rsiPath} fill="none" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

          {series.map((row, index) => {
            const x = series.length <= 1 ? WIDTH / 2 : (index / (series.length - 1)) * WIDTH;
            const prevX = index === 0 ? 0 : (x + ((index - 1) / Math.max(series.length - 1, 1)) * WIDTH) / 2;
            const nextX = index === series.length - 1 ? WIDTH : (x + (((index + 1) / Math.max(series.length - 1, 1)) * WIDTH)) / 2;

            return (
              <rect
                key={`rsi-hover-${row.time}`}
                x={prevX}
                y="0"
                width={Math.max(8, nextX - prevX)}
                height={PANEL_HEIGHT}
                fill="transparent"
                onMouseEnter={() => onHoverTimeChange?.(row.time)}
                onMouseMove={() => onHoverTimeChange?.(row.time)}
              />
            );
          })}

          {active ? (
            <line
              x1={series.length <= 1 ? WIDTH / 2 : (activeIndex / (series.length - 1)) * WIDTH}
              x2={series.length <= 1 ? WIDTH / 2 : (activeIndex / (series.length - 1)) * WIDTH}
              y1={PLOT_TOP}
              y2={PLOT_TOP + plotHeight}
              stroke="rgba(148,163,184,0.55)"
              strokeDasharray="4 4"
            />
          ) : null}
        </svg>
      </CardContent>
    </Card>
  );
}

export default function ResearchIndicatorPanels({ indicators, interval = "1min", hoverTime = null, onHoverTimeChange }) {
  const [showVolume, setShowVolume] = useState(false);
  const [showMacd, setShowMacd] = useState(false);
  const [showRsi, setShowRsi] = useState(false);
  const panelSeries = useMemo(() => toSeries(indicators?.panels?.[interval]), [indicators, interval]);
  const enrichedSeries = useMemo(() => {
    const closeValues = panelSeries.map((row) => Number(row?.close));
    const rsiValues = computeRsi(closeValues, 14);

    return panelSeries.map((row, index) => ({
      ...row,
      rsi: Number.isFinite(Number(row?.rsi)) ? Number(row.rsi) : rsiValues[index],
    }));
  }, [panelSeries]);

  if (!enrichedSeries.length) {
    return (
      <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Technical Panels</CardTitle>
          <CardDescription>Indicator panels will appear here when enough backend-computed data is available.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Indicator Panels</CardTitle>
            <CardDescription>Backend-computed overlays aligned with the active chart interval.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <ToggleButton active={showVolume} onClick={() => setShowVolume((current) => !current)}>
              {showVolume ? "Hide Volume" : "Show Volume"}
            </ToggleButton>
            <ToggleButton active={showRsi} onClick={() => setShowRsi((current) => !current)}>
              {showRsi ? "Hide RSI" : "Show RSI"}
            </ToggleButton>
            <ToggleButton active={showMacd} onClick={() => setShowMacd((current) => !current)}>
              {showMacd ? "Hide MACD" : "Show MACD"}
            </ToggleButton>
          </div>
        </CardHeader>
      </Card>

      {showVolume ? <VolumePanel series={enrichedSeries} hoverTime={hoverTime} onHoverTimeChange={onHoverTimeChange} /> : null}
      {showRsi ? <RsiPanel series={enrichedSeries} hoverTime={hoverTime} onHoverTimeChange={onHoverTimeChange} /> : null}
      {showMacd ? <MacdPanel series={enrichedSeries} hoverTime={hoverTime} onHoverTimeChange={onHoverTimeChange} /> : null}
    </div>
  );
}