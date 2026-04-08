"use client";

import { useMemo, useState } from "react";

import { formatDate, formatPercent } from "@/components/research/formatters";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STYLE_BY_TYPE = {
  STRONG_BEAT: {
    bar: "bg-emerald-400/22",
    marker: "bg-emerald-400",
    markerText: "text-emerald-400",
    label: "Beat",
  },
  FADE: {
    bar: "bg-amber-300/22",
    marker: "bg-amber-300",
    markerText: "text-amber-300",
    label: "Beat, faded",
  },
  STRONG_MISS: {
    bar: "bg-rose-400/22",
    marker: "bg-rose-400",
    markerText: "text-rose-400",
    label: "Miss",
  },
  SQUEEZE: {
    bar: "bg-orange-400/22",
    marker: "bg-orange-400",
    markerText: "text-orange-400",
    label: "Miss, squeezed",
  },
};

const PLOT_HEIGHT = 220;
const LABEL_ROW_HEIGHT = 36;

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function classifyType(beat, move) {
  const isUpMove = move >= 0;

  if (beat && isUpMove) return "STRONG_BEAT";
  if (beat && !isUpMove) return "FADE";
  if (!beat && !isUpMove) return "STRONG_MISS";
  return "SQUEEZE";
}

function sortByDateAsc(rows) {
  return [...rows].sort((left, right) => {
    const leftTime = new Date(left.date).getTime();
    const rightTime = new Date(right.date).getTime();

    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
      return 0;
    }

    return leftTime - rightTime;
  });
}

function derivePatternFromHistory(history) {
  return (Array.isArray(history) ? history : [])
    .slice(0, 8)
    .map((row) => {
      const date = String(row?.date || "").trim();
      const epsActual = toNumber(row?.eps_actual ?? row?.epsActual);
      const epsEstimate = toNumber(row?.eps_estimate ?? row?.epsEstimated);
      const move = toNumber(row?.post_move_percent ?? row?.postMovePercent ?? row?.actual_move_percent ?? row?.actualMove);

      if (!date || epsActual === null || epsEstimate === null || move === null) {
        return null;
      }

      const beat = epsActual > epsEstimate;
      return {
        type: classifyType(beat, move),
        move,
        beat,
        date,
      };
    })
    .filter(Boolean);
}

function normalizePattern(pattern, history) {
  const source = Array.isArray(pattern) && pattern.length > 0 ? pattern : derivePatternFromHistory(history);

  return sortByDateAsc(source)
    .map((item) => {
      const move = toNumber(item?.move);
      const date = String(item?.date || "").trim();
      const type = String(item?.type || "").trim();

      if (!date || move === null || !STYLE_BY_TYPE[type]) {
        return null;
      }

      return {
        type,
        move,
        beat: Boolean(item?.beat),
        date,
      };
    })
    .filter(Boolean);
}

function quarterLabel(date) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  const quarter = Math.floor(parsed.getMonth() / 3) + 1;
  const year = String(parsed.getFullYear()).slice(-2);
  return `Q${quarter} ${year}`;
}

function roundUpStep(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 10;
  }

  if (value <= 10) {
    return Math.ceil(value / 2) * 2;
  }

  if (value <= 20) {
    return Math.ceil(value / 5) * 5;
  }

  return Math.ceil(value / 10) * 10;
}

function buildScale(rows) {
  const maxAbsMove = rows.reduce((max, row) => Math.max(max, Math.abs(row.move)), 0);
  const chartMax = Math.max(8, roundUpStep(maxAbsMove));
  const levels = [chartMax, chartMax / 2, 0, -chartMax / 2, -chartMax];

  return {
    chartMax,
    levels,
  };
}

function toY(value, chartMax) {
  const clamped = Math.max(-chartMax, Math.min(chartMax, value));
  return ((chartMax - clamped) / (chartMax * 2)) * 100;
}

function Marker({ item, style, top }) {
  if (item.beat) {
    return (
      <div
        className={`absolute left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 shadow-[0_0_14px_rgba(15,23,42,0.85)] ${style.marker}`}
        style={{ top: `${top}px` }}
      />
    );
  }

  return (
    <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ top: `${top}px` }}>
      <span className={`block text-lg font-bold leading-none ${style.markerText}`}>×</span>
    </div>
  );
}

export default function EarningsPatternBar({ pattern, history }) {
  const [range, setRange] = useState(6);
  const rows = useMemo(() => {
    const normalized = normalizePattern(pattern, history);
    return range >= 999 ? normalized : normalized.slice(-range);
  }, [history, pattern, range]);

  if (rows.length === 0) {
    return null;
  }

  const { chartMax, levels } = buildScale(rows);
  const averageMove = rows.reduce((sum, row) => sum + row.move, 0) / rows.length;

  return (
    <Card className="border-slate-800/80 bg-slate-950/50">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Earnings Beat / Miss</CardTitle>
            <CardDescription>
              For the past {rows.length} quarters, average post-earnings move was {formatPercent(averageMove, 2)}.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {[6, 12, 999].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRange(option)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.12em] transition ${range === option ? "border-teal-500/40 bg-teal-500/10 text-teal-100" : "border-slate-700/80 bg-slate-900/80 text-slate-300"}`}
              >
                {option >= 999 ? "All" : `${option} Quarters`}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="relative pl-12">
          <div className="pointer-events-none absolute left-0 top-0 w-12 text-xs text-slate-500" style={{ height: `${PLOT_HEIGHT}px` }}>
            {levels.map((level) => (
              <div
                key={level}
                className="absolute left-0 -translate-y-1/2"
                style={{ top: `${(toY(level, chartMax) / 100) * PLOT_HEIGHT}px` }}
              >
                {formatPercent(level, 0)}
              </div>
            ))}
          </div>

          <div className="relative" style={{ height: `${PLOT_HEIGHT + LABEL_ROW_HEIGHT}px` }}>
            {levels.map((level) => (
              <div
                key={`grid-${level}`}
                className={`absolute inset-x-0 border-t ${level === 0 ? "border-slate-600/80" : "border-slate-800/70"}`}
                style={{ top: `${(toY(level, chartMax) / 100) * PLOT_HEIGHT}px` }}
              />
            ))}

            <div className="absolute inset-x-0 top-0 flex gap-4 md:gap-5" style={{ height: `${PLOT_HEIGHT}px` }}>
              <svg viewBox={`0 0 100 ${PLOT_HEIGHT}`} className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                <path
                  d={rows.map((item, index) => {
                    const markerY = (toY(item.move, chartMax) / 100) * PLOT_HEIGHT;
                    const x = rows.length === 1 ? 0 : (index / (rows.length - 1)) * 100;
                    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${markerY.toFixed(2)}`;
                  }).join(" ")}
                  fill="none"
                  stroke="rgba(148,163,184,0.35)"
                  strokeWidth="2"
                />
              </svg>
              {rows.map((item) => {
                const style = STYLE_BY_TYPE[item.type];
                const tooltipLabel = `${formatDate(item.date)} | ${item.beat ? "Beat" : "Miss"} | ${formatPercent(item.move, 1)}`;
                const markerY = (toY(item.move, chartMax) / 100) * PLOT_HEIGHT;
                const zeroY = (toY(0, chartMax) / 100) * PLOT_HEIGHT;
                const barTop = Math.min(markerY, zeroY);
                const barHeight = Math.max(10, Math.abs(zeroY - markerY));

                return (
                  <div key={`${item.date}-${item.type}`} className="group relative min-w-0 flex-1">
                    <div className="relative h-full w-full">
                      <div
                        title={tooltipLabel}
                        className={`absolute left-1/2 w-9 -translate-x-1/2 rounded-full ${style.bar}`}
                        style={{
                          height: `${barHeight}px`,
                          top: `${barTop}px`,
                        }}
                        aria-label={tooltipLabel}
                      />
                      <Marker item={item} style={style} top={markerY} />

                      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-[220px] -translate-x-1/2 rounded-xl border border-slate-700/90 bg-slate-950/95 px-3 py-2 text-xs text-slate-100 shadow-2xl group-hover:block">
                        <div className="font-semibold text-slate-50">{formatDate(item.date)}</div>
                        <div className="mt-1 text-slate-300">{style.label}</div>
                        <div className="text-slate-300">{formatPercent(item.move, 1)}</div>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>

            <div className="absolute inset-x-0 bottom-0 flex gap-4 md:gap-5" style={{ height: `${LABEL_ROW_HEIGHT}px` }}>
              {rows.map((item) => (
                <div key={`${item.date}-label`} className="flex min-w-0 flex-1 items-end justify-center">
                  <div className="text-xs font-medium tracking-[0.08em] text-slate-400">{quarterLabel(item.date)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-emerald-400" />Strong beat</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-amber-300" />Fade</div>
            <div className="flex items-center gap-2"><span className="text-lg leading-none text-rose-400">×</span>Strong miss</div>
            <div className="flex items-center gap-2"><span className="text-lg leading-none text-orange-400">×</span>Squeeze</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}