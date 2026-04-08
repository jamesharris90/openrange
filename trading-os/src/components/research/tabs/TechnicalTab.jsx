"use client";

import InsightBlock from "@/components/research/InsightBlock";
import MetricGridCard from "@/components/research/MetricGridCard";
import { formatBooleanLabel, formatMetricPercent, formatNumber } from "@/components/research/formatters";

function SignalPill({ label, tone }) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold tracking-[0.14em] ${tone}`}>
      <span className="h-2.5 w-2.5 rounded-full bg-current opacity-80" />
      <span>{label}</span>
    </div>
  );
}

function getSignalStack(technical) {
  const rsi = Number(technical?.rsi14);
  return [
    {
      key: "rsi",
      label: `RSI ${Number.isFinite(rsi) ? rsi.toFixed(1) : "—"}`,
      tone: !Number.isFinite(rsi) ? "border-slate-700 bg-slate-900/70 text-slate-400" : rsi < 30 ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : rsi > 70 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200",
    },
    {
      key: "vwap",
      label: `VWAP ${technical?.above_vwap === true ? "Above" : technical?.above_vwap === false ? "Below" : "—"}`,
      tone: technical?.above_vwap === true ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : technical?.above_vwap === false ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-slate-700 bg-slate-900/70 text-slate-400",
    },
    {
      key: "sma20",
      label: "SMA 20",
      tone: technical?.above_sma20 === true ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : technical?.above_sma20 === false ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-slate-700 bg-slate-900/70 text-slate-400",
    },
    {
      key: "sma50",
      label: "SMA 50",
      tone: technical?.above_sma50 === true ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : technical?.above_sma50 === false ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-slate-700 bg-slate-900/70 text-slate-400",
    },
    {
      key: "sma200",
      label: "SMA 200",
      tone: technical?.above_sma200 === true ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : technical?.above_sma200 === false ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-slate-700 bg-slate-900/70 text-slate-400",
    },
    {
      key: "squeeze",
      label: `Squeeze ${technical?.squeeze_setup === true ? "Active" : technical?.squeeze_setup === false ? "Off" : "—"}`,
      tone: technical?.squeeze_setup === true ? "border-violet-500/30 bg-violet-500/10 text-violet-200" : "border-slate-700 bg-slate-900/70 text-slate-400",
    },
  ];
}

function buildTechnicalRead(technical) {
  const aboveVwap = technical?.above_vwap;
  const aboveSma20 = technical?.above_sma20;
  const aboveSma50 = technical?.above_sma50;
  const rsi = Number(technical?.rsi14);

  if (aboveVwap === true && aboveSma20 === true && aboveSma50 === true && Number.isFinite(rsi) && rsi >= 55) {
    return "Short-term structure is constructive. Price is holding above key references and momentum is supportive without already looking exhausted.";
  }

  if (aboveVwap === false && aboveSma20 === false && aboveSma50 === false) {
    return "Structure is weak across VWAP and the main moving-average references. Treat bounce attempts cautiously until price reclaims those levels.";
  }

  return "Technical conditions are mixed. Use the indicator stack as confirmation instead of forcing a trade off one isolated signal.";
}

export default function TechnicalTab({ terminal }) {
  const technical = terminal.scanner?.technical || {};
  const signalStack = getSignalStack(technical);
  const items = [
    { label: "RSI (14)", value: formatNumber(technical.rsi14) },
    { label: "ATR %", value: formatMetricPercent(technical.atr_percent, { signed: false }) },
    { label: "ADR %", value: formatMetricPercent(technical.adr_percent, { signed: false }) },
    { label: "From 52W High %", value: formatMetricPercent(technical.from_52w_high_percent) },
    { label: "From 52W Low %", value: formatMetricPercent(technical.from_52w_low_percent, { signed: false }) },
    { label: "Above VWAP", value: formatBooleanLabel(technical.above_vwap) },
    { label: "Above SMA 20", value: formatBooleanLabel(technical.above_sma20) },
    { label: "Above SMA 50", value: formatBooleanLabel(technical.above_sma50) },
    { label: "Above SMA 200", value: formatBooleanLabel(technical.above_sma200) },
    technical.squeeze_setup !== null && technical.squeeze_setup !== undefined ? { label: "Squeeze Setup", value: formatBooleanLabel(technical.squeeze_setup) } : null,
    { label: "New HOD", value: formatBooleanLabel(technical.new_hod) },
    { label: "Beta", value: formatNumber(technical.beta, 2) },
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {signalStack.map((signal) => <SignalPill key={signal.key} label={signal.label} tone={signal.tone} />)}
      </div>

      <MetricGridCard
        title="Technical"
        description="Indicator and structure fields aligned to the screener filter set. Null metrics are suppressed or rendered as subdued placeholders instead of broken states."
        columns="md:grid-cols-2 xl:grid-cols-3"
        items={items}
      />

      <InsightBlock title="Technical Read" body={buildTechnicalRead(technical)} />
    </div>
  );
}