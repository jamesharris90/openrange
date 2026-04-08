"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { formatPercent } from "@/components/research/formatters";

const EMPTY_COPY = "Insufficient earnings reaction history. No edge.";

function BeatGauge({ value }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.max(0, Math.min(100, Number(value || 0)));
  const offset = circumference - ((percent / 100) * circumference);

  return (
    <div className="flex items-center justify-center rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
      <svg width="110" height="110" viewBox="0 0 110 110" className="overflow-visible">
        <circle cx="55" cy="55" r={radius} fill="none" stroke="rgba(51,65,85,0.65)" strokeWidth="10" />
        <circle
          cx="55"
          cy="55"
          r={radius}
          fill="none"
          stroke="#22d3a0"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 55 55)"
        />
        <text x="55" y="50" textAnchor="middle" className="fill-slate-100 text-[20px] font-semibold">{Math.round(percent)}%</text>
        <text x="55" y="68" textAnchor="middle" className="fill-slate-500 text-[10px] font-semibold tracking-[0.18em]">BEAT RATE</text>
      </svg>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function displayLabel(edge) {
  return String(edge?.edge_label || edge?.edgeLabel || 'NO_EDGE').replace(/_/g, ' ');
}

function confidenceTone(value) {
  if (value === "HIGH") return "text-emerald-300";
  if (value === "MEDIUM") return "text-amber-300";
  return "text-rose-300";
}

export default function EarningsEdge({ edge }) {
  const hasData = Number(edge?.sample_size || 0) >= 3;
  const label = String(edge?.edge_label || edge?.edgeLabel || 'NO_EDGE');
  const confidenceLabel = String(edge?.confidenceLabel || "LOW").toUpperCase();

  return (
    <Card className="border-slate-800/80 bg-slate-950/50">
      <CardHeader>
        <CardTitle>Earnings Edge</CardTitle>
        <CardDescription>Historical beat behavior and actual reaction quality.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.18em] ${label === "HIGH EDGE" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>
          {displayLabel(edge)}
        </div>
        {hasData ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[0.9fr_repeat(4,minmax(0,1fr))]">
              <BeatGauge value={Number(edge?.beat_rate ?? edge?.beatRate ?? 0) * 100} />
              <Metric label="Edge Score" value={Number(edge?.edge_score ?? edge?.edgeScore ?? 0).toFixed(1)} />
              <Metric label="Beat Rate" value={formatPercent(Number(edge?.beat_rate ?? edge?.beatRate ?? 0) * 100, 1)} />
              <Metric label="Avg Move" value={formatPercent(Number(edge?.avg_move ?? edge?.avgMove ?? 0), 1)} />
              <Metric label="Consistency" value={Number(edge?.consistency ?? edge?.consistencyScore ?? 0).toFixed(2)} />
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Metric label="Up Move" value={formatPercent(Number(edge?.avg_up_move ?? edge?.avgUpMove ?? 0), 1)} />
              <Metric label="Down Move" value={formatPercent(Number(edge?.avg_down_move ?? edge?.avgDownMove ?? 0), 1)} />
              <Metric label="Bias" value={String(edge?.directional_bias ?? edge?.directionalBias ?? 'MIXED')} />
              <Metric label="Samples" value={String(edge?.sample_size ?? 0)} />
            </div>

            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Read</div>
              <div className="mt-2 text-sm leading-6 text-slate-200">{edge?.read || EMPTY_COPY}</div>
            </div>

            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Confidence</div>
              <div className={`mt-2 text-xl font-semibold ${confidenceTone(confidenceLabel)}`}>{confidenceLabel}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/45 px-4 py-8 text-sm text-slate-300">
            {edge?.read || EMPTY_COPY}
          </div>
        )}
      </CardContent>
    </Card>
  );
}