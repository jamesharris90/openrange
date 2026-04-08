"use client";

import { useMemo } from "react";

import { toNum } from "@/lib/cockpit/rules";
import type { DecisionAction, DecisionUrgency } from "@/lib/decisionEngine";

export function confidenceTone(value: number) {
  if (value > 80) return "text-emerald-400";
  if (value >= 60) return "text-amber-400";
  return "text-rose-400";
}

function confidenceStroke(value: number) {
  if (value > 80) return "#34d399";
  if (value >= 60) return "#f59e0b";
  return "#fb7185";
}

export function ConfidenceRadialGauge({ value, size = 84 }: { value: unknown; size?: number }) {
  const safe = Math.max(0, Math.min(100, toNum(value, 0)));
  const stroke = confidenceStroke(safe);
  const radius = (size - 14) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (safe / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Confidence ${safe.toFixed(0)} percent`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth="8" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-xl font-bold ${confidenceTone(safe)}`}>{safe.toFixed(0)}</span>
      </div>
    </div>
  );
}

export function ConfidenceGauge({ value, size = 84 }: { value: unknown; size?: number }) {
  return <ConfidenceRadialGauge value={value} size={size} />;
}

export function ExpectedMoveBar({ expectedMovePercent, changePercent }: { expectedMovePercent: unknown; changePercent: unknown }) {
  const move = Math.abs(toNum(expectedMovePercent, 0));
  const pct = Math.min(move * 8, 100);
  const change = Math.abs(toNum(changePercent, 0));
  const atrRatio = move > 0 ? move / Math.max(change, 0.1) : 0;

  return (
    <div>
      <div className="h-2 rounded-full bg-[var(--muted)] overflow-hidden">
        <div className="h-full bg-cyan-400" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">
        {move.toFixed(2)}% | ATR x{atrRatio.toFixed(1)}
      </div>
    </div>
  );
}

export function UrgencyPulse({ relativeVolume, changePercent }: { relativeVolume: unknown; changePercent: unknown }) {
  const rvol = toNum(relativeVolume, 0);
  const move = Math.abs(toNum(changePercent, 0));
  const urgent = rvol > 3 && move > 0.15;

  if (!urgent) return <span className="text-[10px] text-[var(--muted-foreground)]">Stable</span>;

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-amber-300">
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-amber-300/60 animate-ping" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-300" />
      </span>
      Urgent
    </span>
  );
}

export function SymbolLogo({ symbol }: { symbol: string }) {
  const src = useMemo(() => `https://logo.clearbit.com/${symbol.toLowerCase()}.com`, [symbol]);

  return (
    <div className="relative h-8 w-8 rounded-full border border-[var(--border)] bg-[var(--muted)] overflow-hidden">
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-[var(--muted-foreground)]">{symbol.slice(0, 1)}</span>
      {/* clearbit is used directly because this fallback avatar needs raw onError handling without extra image config */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`${symbol} logo`}
        className="absolute inset-0 h-full w-full object-cover"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
    </div>
  );
}

function decisionTone(action: DecisionAction) {
  if (action === "ENTER") return "bg-emerald-500/16 border-emerald-400/40 text-emerald-300";
  if (action === "WATCH") return "bg-cyan-500/16 border-cyan-400/40 text-cyan-300";
  if (action === "WAIT") return "bg-amber-500/16 border-amber-400/40 text-amber-300";
  return "bg-rose-500/16 border-rose-400/40 text-rose-300";
}

function urgencyTone(urgency: DecisionUrgency) {
  if (urgency === "HIGH") return "text-rose-300";
  if (urgency === "MED") return "text-amber-300";
  return "text-slate-300";
}

export function DecisionBadge({
  action,
  urgency,
  size = "md",
}: {
  action: DecisionAction;
  urgency: DecisionUrgency;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = size === "lg" ? "px-4 py-2 text-sm" : size === "sm" ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs";
  return (
    <div className={`inline-flex items-center gap-2 rounded-xl border font-semibold tracking-wide ${decisionTone(action)} ${sizeClass}`}>
      <span>{action}</span>
      <span className={`text-[10px] ${urgencyTone(urgency)}`}>{urgency}</span>
    </div>
  );
}
