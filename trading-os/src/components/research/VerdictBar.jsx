"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { formatCurrency, formatNumber, formatPercent } from "@/components/research/formatters";

function verdictTone(status) {
  const text = String(status || "WATCH").toUpperCase();
  if (text === "TRADEABLE") return "border-emerald-500/35 bg-emerald-500/12 text-emerald-200";
  if (text === "AVOID") return "border-rose-500/35 bg-rose-500/12 text-rose-200";
  return "border-amber-500/35 bg-amber-500/12 text-amber-200";
}

function biasMeta(value) {
  const text = String(value || "NEUTRAL").toUpperCase();
  if (text === "BULLISH") return { label: "BULLISH ↗", tone: "text-emerald-200" };
  if (text === "BEARISH") return { label: "BEARISH ↘", tone: "text-rose-200" };
  return { label: "NEUTRAL →", tone: "text-amber-200" };
}

function regimeTone(value) {
  const text = String(value || "BALANCED").toUpperCase();
  if (text === "RISK_OFF") return "border-rose-500/35 bg-rose-500/12 text-rose-200";
  if (text === "RISK_ON" || text === "TRENDING_UP") return "border-emerald-500/35 bg-emerald-500/12 text-emerald-200";
  return "border-amber-500/35 bg-amber-500/12 text-amber-200";
}

function classifyVix(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return { label: "UNKNOWN", tone: "border-slate-700 bg-slate-900/70 text-slate-300" };
  }

  if (numeric >= 30) {
    return { label: "EXTREME", tone: "border-rose-500/45 bg-rose-500/15 text-rose-100 shadow-[0_0_18px_rgba(239,68,68,0.2)]" };
  }

  if (numeric >= 25) {
    return { label: "HIGH", tone: "border-rose-500/35 bg-rose-500/12 text-rose-200" };
  }

  if (numeric >= 18) {
    return { label: "ELEVATED", tone: "border-amber-500/35 bg-amber-500/12 text-amber-200" };
  }

  return { label: "LOW", tone: "border-emerald-500/35 bg-emerald-500/12 text-emerald-200" };
}

function confidenceTone(value) {
  if (value >= 70) return "bg-emerald-400";
  if (value >= 45) return "bg-amber-400";
  return "bg-rose-400";
}

function dcsTone(value) {
  if (value >= 80) return "border-teal-500/35 bg-teal-500/12 text-teal-100";
  if (value >= 60) return "border-amber-500/35 bg-amber-500/12 text-amber-200";
  return "border-rose-500/35 bg-rose-500/12 text-rose-200";
}

function formatTimestamp(value) {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function VerdictBar({ symbol, companyName, price, decision, context, score }) {
  const status = String(decision?.status || (decision?.tradeable ? "TRADEABLE" : "WATCH")).toUpperCase();
  const bias = biasMeta(decision?.bias);
  const confidence = Number(decision?.confidence || 0);
  const regime = String(context?.regime || "BALANCED").toUpperCase();
  const vix = classifyVix(context?.vix_level);
  const dcs = Number(score?.data_confidence || 0);
  const conflict = regime === "RISK_OFF" && status === "TRADEABLE";

  return (
    <div className="sticky top-3 z-30">
      <div className="rounded-[1.6rem] border border-slate-800/80 bg-[linear-gradient(135deg,rgba(7,12,23,0.94),rgba(10,18,33,0.94))] px-4 py-3 shadow-[0_16px_40px_rgba(2,6,23,0.35)] backdrop-blur">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <div className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-3 py-1 text-sm font-semibold tracking-[0.18em] text-cyan-100">{symbol}</div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-50 xl:max-w-[240px]">{companyName || symbol}</div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                <span className="font-semibold text-slate-50">{formatCurrency(price?.price)}</span>
                <span className={cn("font-semibold", Number(price?.change_percent || 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{formatPercent(price?.change_percent)}</span>
              </div>
            </div>
            <div className={cn("rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.16em]", verdictTone(status))}>{status}</div>
            {conflict ? (
              <div
                title="Regime conflict: Market risk-off but ticker flagged tradeable. Trade with extra caution."
                className="rounded-full border border-amber-500/35 bg-amber-500/12 px-3 py-1 text-xs font-semibold tracking-[0.12em] text-amber-200"
              >
                ⚠ Regime conflict
              </div>
            ) : null}
            <div className={cn("text-xs font-semibold tracking-[0.16em]", bias.tone)}>{bias.label}</div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:flex xl:items-center xl:gap-3">
            <div className="min-w-[150px] rounded-2xl border border-slate-800/80 bg-slate-950/60 px-3 py-2">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <span>Confidence</span>
                <span className="text-slate-200">{Math.round(confidence)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800/90">
                <div className={cn("h-full rounded-full transition-all", confidenceTone(confidence))} style={{ width: `${Math.max(0, Math.min(100, confidence))}%` }} />
              </div>
            </div>

            <Badge variant="outline" className="justify-center border-slate-700/80 bg-slate-900/70 px-3 py-2 text-[11px] tracking-[0.18em] text-slate-200">
              {String(decision?.driver || "TECHNICAL").replaceAll("_", " ")}
            </Badge>

            <div className="flex flex-wrap items-center gap-2">
              <div className={cn("rounded-full border px-3 py-2 text-[11px] font-semibold tracking-[0.16em]", regimeTone(regime))}>{regime}</div>
              <div className={cn("rounded-full border px-3 py-2 text-[11px] font-semibold tracking-[0.16em]", context?.sectorTailwind ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-slate-700 bg-slate-900/70 text-slate-300")}>{context?.sectorTailwind ? "Sector Tailwind" : "Sector Headwind"}</div>
            </div>

            <div className={cn("rounded-full border px-3 py-2 text-[11px] font-semibold tracking-[0.16em]", vix.tone)}>{`VIX ${formatNumber(context?.vix_level, 2)} · ${vix.label}`}</div>
            <div className={cn("rounded-full border px-3 py-2 text-[11px] font-semibold tracking-[0.16em]", dcsTone(dcs))}>{`DCS ${Math.round(dcs)} · ${String(score?.data_confidence_label || "LOW").toUpperCase()}`}</div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] tracking-[0.14em] text-slate-500">
              <span>{`Updated ${formatTimestamp(context?.lastUpdated || context?.updated_at)}`}</span>
              {context?.stale ? <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-semibold uppercase text-amber-200">Stale</span> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}