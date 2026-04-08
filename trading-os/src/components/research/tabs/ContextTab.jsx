"use client";

import InsightBlock from "@/components/research/InsightBlock";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { formatPercent } from "@/components/research/formatters";

const WARMING_COPY = "—";

function toneClasses(value) {
  if (value === "bullish") return "text-emerald-300";
  if (value === "bearish") return "text-rose-300";
  return "text-slate-200";
}

function TrendCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${toneClasses(value)}`}>{(value || "neutral").toUpperCase()}</div>
    </div>
  );
}

function classifyVix(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "UNKNOWN";
  }

  if (value >= 25) return "HIGH";
  if (value >= 18) return "ELEVATED";
  return "LOW";
}

function buildContextInsight(context) {
  const spy = context?.spy_trend || "neutral";
  const qqq = context?.qqq_trend || "neutral";
  const vixLabel = classifyVix(context?.vix_level);

  if (spy === "bullish" && qqq === "bullish" && vixLabel === "LOW") {
    return "Macro tape is supportive. Index trend and volatility regime both favor cleaner continuation setups.";
  }

  if (spy === "bearish" || qqq === "bearish" || vixLabel === "HIGH") {
    return "Macro conditions are defensive. Expect weaker follow-through and a higher burden of proof for breakout trades.";
  }

  return "Macro context is mixed. Use company-specific catalysts and risk compression to decide whether the setup deserves attention.";
}

export default function ContextTab({ context }) {
  const leaders = Array.isArray(context?.sectorLeaders) ? context.sectorLeaders : [];
  const laggers = Array.isArray(context?.sectorLaggers) ? context.sectorLaggers : [];

  return (
    <div className="space-y-4">
      <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Context</CardTitle>
          <CardDescription>Macro tape and sector-relative strength from cached market tables.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <TrendCard label="SPY Trend" value={context?.spy_trend} />
          <TrendCard label="QQQ Trend" value={context?.qqq_trend} />
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">VIX Level</div>
            <div className="mt-2 text-xl font-semibold text-slate-100">
              {typeof context?.vix_level === "number" ? `${context.vix_level.toFixed(2)} · ${classifyVix(context.vix_level)}` : WARMING_COPY}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Market Regime</CardTitle>
          <CardDescription>Actionable regime and sector leadership built from cached market context.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Regime</div>
            <div className="mt-2 text-xl font-semibold text-slate-100">{context?.regime || WARMING_COPY}</div>
            <div className="mt-2 text-sm text-slate-400">{context?.regimeBias || WARMING_COPY}</div>
            <div className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.18em] ${context?.sectorTailwind ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-slate-700 bg-slate-900/60 text-slate-300"}`}>
              {context?.sectorTailwind ? "Sector Tailwind" : "No Sector Tailwind"}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Sector Leaders</div>
              {leaders.length > 0 ? leaders.map((item) => (
                <div key={item.sector} className="flex items-center justify-between rounded-2xl border border-slate-800/70 bg-slate-950/40 px-4 py-3">
                  <span className="text-sm text-slate-300">{item.sector}</span>
                  <span className="text-sm font-semibold text-emerald-300">{formatPercent(Number(item.change), 1)}</span>
                </div>
              )) : <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-6 text-sm text-slate-300">{WARMING_COPY}</div>}
            </div>

            <div className="space-y-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Sector Laggers</div>
              {laggers.length > 0 ? laggers.map((item) => (
                <div key={item.sector} className="flex items-center justify-between rounded-2xl border border-slate-800/70 bg-slate-950/40 px-4 py-3">
                  <span className="text-sm text-slate-300">{item.sector}</span>
                  <span className="text-sm font-semibold text-rose-300">{formatPercent(Number(item.change), 1)}</span>
                </div>
              )) : <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-6 text-sm text-slate-300">{WARMING_COPY}</div>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Market Narrative</CardTitle>
          <CardDescription>Cached institutional summary generated from SPY, QQQ, and VIX context.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-slate-300">{context?.narrative || WARMING_COPY}</p>
        </CardContent>
      </Card>

      <InsightBlock title="Context Read" body={buildContextInsight(context)} />
    </div>
  );
}