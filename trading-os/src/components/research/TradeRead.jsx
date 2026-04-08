"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { formatPercent } from "@/components/research/formatters";

const EMPTY_COPY = "No upcoming earnings scheduled.";

function getBias(changePercent) {
  if (typeof changePercent !== "number" || Number.isNaN(changePercent)) {
    return { label: "NEUTRAL", tone: "text-slate-100" };
  }

  if (changePercent > 2) {
    return { label: "BULLISH", tone: "text-emerald-300" };
  }

  if (changePercent < -2) {
    return { label: "BEARISH", tone: "text-rose-300" };
  }

  return { label: "NEUTRAL", tone: "text-slate-100" };
}

function Metric({ label, value, tone = "text-slate-100" }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default function TradeRead({ price, earningsInsight, earningsEdge, earningsRead }) {
  const bias = getBias(price?.change_percent);
  const volatility = earningsInsight?.tradeable ? "HIGH" : "CONTROLLED";
  const directive = String(earningsRead || earningsEdge?.read || EMPTY_COPY);

  return (
    <Card className="border-slate-800/80 bg-[linear-gradient(160deg,rgba(8,15,29,0.98),rgba(15,23,42,0.92))]">
      <CardHeader>
        <CardTitle>Trade Read</CardTitle>
        <CardDescription>Short, direct, actionable read built from price, event behavior, and regime.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4 text-sm leading-6 text-slate-200">
          {directive}
        </div>
        <Metric label="Bias" value={bias.label} tone={bias.tone} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Beat Rate" value={formatPercent(earningsInsight?.beatRate)} />
          <Metric label="Expected Move" value={formatPercent(earningsInsight?.expectedMove)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Volatility" value={volatility} tone={earningsInsight?.tradeable ? "text-amber-300" : "text-cyan-200"} />
          <Metric label="Session Change" value={formatPercent(price?.change_percent)} tone={bias.tone} />
        </div>
      </CardContent>
    </Card>
  );
}