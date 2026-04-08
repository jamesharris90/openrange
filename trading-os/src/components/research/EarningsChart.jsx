"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { formatSignedLabel } from "@/components/research/formatters";

const WARMING_COPY = "No historical earnings data";
const RANGES = [6, 12, 999];

function normalizeRows(history) {
  return (Array.isArray(history) ? history : [])
    .slice(0, 12)
    .map((row) => ({
      date: String(row?.date || "").slice(0, 10),
      label: String(row?.date || "").slice(5),
      expected_move_percent: typeof row?.expected_move_percent === "number" ? row.expected_move_percent : (typeof row?.expectedMove === "number" ? row.expectedMove : 0),
      actual_move_percent: typeof row?.actual_move_percent === "number" ? row.actual_move_percent : (typeof row?.actualMove === "number" ? row.actualMove : 0),
      eps_actual: typeof row?.eps_actual === "number" ? row.eps_actual : (typeof row?.epsActual === "number" ? row.epsActual : 0),
      eps_estimate: typeof row?.eps_estimate === "number" ? row.eps_estimate : (typeof row?.epsEstimated === "number" ? row.epsEstimated : 0),
      surprise_percent: typeof row?.surprise_percent === "number" ? row.surprise_percent : (typeof row?.surprisePercent === "number" ? row.surprisePercent : 0),
      beat: typeof row?.beat === "boolean"
        ? row.beat
        : typeof row?.eps_actual === "number" && typeof row?.eps_estimate === "number"
          ? row.eps_actual > row.eps_estimate
          : typeof row?.epsActual === "number" && typeof row?.epsEstimated === "number"
            ? row.epsActual > row.epsEstimated
            : false,
    }))
    .reverse();
}

function pointTone(row) {
  const move = Number(row?.actual_move_percent || 0);
  if (row?.beat && move >= 0) return "#22d3a0";
  if (row?.beat && move < 0) return "#f0b232";
  return "#ef4444";
}

function renderMoveDot(props) {
  const { cx, cy, payload } = props;
  const fill = pointTone(payload);
  return <circle cx={cx} cy={cy} r={7} fill={fill} stroke="rgba(2,6,23,0.9)" strokeWidth={2} style={{ filter: `drop-shadow(0 0 10px ${fill})` }} />;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0]?.payload || {};
  return (
    <div className="rounded-2xl border border-slate-700/90 bg-slate-950/95 px-4 py-3 text-xs text-slate-100 shadow-2xl">
      <div className="font-semibold text-slate-50">{label}</div>
      <div className="mt-2 space-y-1 text-slate-300">
        <div>{`EPS est ${formatSignedLabel(Number(row.eps_estimate || 0), 2)} vs act ${formatSignedLabel(Number(row.eps_actual || 0), 2)}`}</div>
        <div>{`Surprise ${formatSignedLabel(Number(row.surprise_percent || 0), 1)}%`}</div>
        <div>{`Expected ${formatSignedLabel(Number(row.expected_move_percent || 0), 1)}% vs actual ${formatSignedLabel(Number(row.actual_move_percent || 0), 1)}%`}</div>
      </div>
    </div>
  );
}

export default function EarningsChart({ earnings }) {
  const [range, setRange] = useState(6);
  const rows = useMemo(() => {
    const normalized = normalizeRows(earnings?.history);
    return range >= 999 ? normalized : normalized.slice(-range);
  }, [earnings?.history, range]);

  return (
    <Card className="border-slate-800/80 bg-slate-950/50">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Earnings Visual</CardTitle>
            <CardDescription>Expected versus actual move, plus EPS estimate versus actual with stronger beat-miss signaling.</CardDescription>
          </div>
          <div className="flex gap-2">
            {RANGES.map((option) => {
              const label = option >= 999 ? "All" : `${option} Quarters`;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${range === option ? "border-teal-500/40 bg-teal-500/10 text-teal-100" : "border-slate-700 bg-slate-900/70 text-slate-300"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {rows.length > 0 ? (
          <>
            <div className="h-[300px] w-full rounded-3xl border border-slate-800/70 bg-slate-950/35 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <defs>
                    <linearGradient id="earningsBeatBar" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#22d3a0" stopOpacity="0.95" />
                      <stop offset="100%" stopColor="#0f766e" stopOpacity="0.4" />
                    </linearGradient>
                    <linearGradient id="earningsMissBar" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity="0.95" />
                      <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0.45" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "rgba(15,23,42,0.45)" }} content={<CustomTooltip />} />
                  <Bar dataKey="expected_move_percent" radius={[8, 8, 0, 0]}>
                    {rows.map((row) => <Cell key={`${row.date}-bar`} fill={row.beat ? "url(#earningsBeatBar)" : "url(#earningsMissBar)"} />)}
                  </Bar>
                  <Line type="linear" dataKey="actual_move_percent" stroke="rgba(148,163,184,0.35)" strokeWidth={2} dot={false} activeDot={false} />
                  <Scatter dataKey="actual_move_percent" shape={renderMoveDot} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="h-[260px] w-full rounded-3xl border border-slate-800/70 bg-slate-950/35 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<CustomTooltip />} />
                  <Line type="linear" dataKey="eps_estimate" stroke="#64748b" strokeWidth={2} dot={{ r: 4, fill: "#64748b" }} />
                  <Line type="linear" dataKey="eps_actual" stroke="#22d3a0" strokeWidth={2.5} dot={{ r: 6, fill: "#22d3a0", stroke: "#020617", strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-950/45 px-4 py-10 text-center text-sm text-slate-400">
            {WARMING_COPY}
          </div>
        )}
      </CardContent>
    </Card>
  );
}