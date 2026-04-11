"use client";

import { memo } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { formatCurrency } from "@/components/research/formatters";

function toneClass(value) {
  const text = String(value || '').toUpperCase();
  if (text === 'TRADEABLE' || text === 'BULLISH') return 'text-emerald-300';
  if (text === 'AVOID' || text === 'BEARISH') return 'text-rose-300';
  if (text === 'MEDIUM') return 'text-amber-300';
  return 'text-slate-100';
}

function DetailBlock({ label, value, tone = false, compact = false }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 ${compact ? 'text-xs' : 'text-sm'} font-semibold leading-6 ${tone ? toneClass(value) : 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

function parseLevel(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildInvalidation(payload, regime) {
  const exitLevel = parseLevel(payload?.execution_plan?.stop || payload?.execution_plan?.invalidation || payload?.execution_plan?.exit);
  return [
    exitLevel !== null ? `Thesis invalid if price closes beyond ${formatCurrency(exitLevel)}.` : "Price invalidation is still estimating.",
    String(payload?.setup || "").toUpperCase().includes("DAY") ? "Setup expires at the end of the session." : "Time invalidation depends on follow-through over the next two sessions.",
    regime ? `Watch for regime shift. Current regime: ${String(regime).replaceAll("_", " ")}.` : "Watch for macro regime shift.",
    payload?.driver ? `Catalyst-driven. If ${String(payload.driver).replaceAll("_", " ").toLowerCase()} fades, conviction weakens.` : "Catalyst-driven conviction is limited until a clean driver appears.",
  ];
}

function HowLadder({ payload, currentPrice }) {
  const levels = [
    { label: "Entry", value: parseLevel(payload?.execution_plan?.entry), tone: "bg-cyan-400" },
    { label: "Current", value: parseLevel(currentPrice), tone: "bg-slate-300" },
    { label: "Target", value: parseLevel(payload?.execution_plan?.target), tone: "bg-emerald-400" },
    { label: "Exit", value: parseLevel(payload?.execution_plan?.stop || payload?.execution_plan?.invalidation), tone: "bg-rose-400" },
  ].filter((item) => item.value !== null);

  if (levels.length === 0) {
    return <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-950/40 px-4 py-5 text-sm text-slate-400">Structured price levels are still estimating.</div>;
  }

  const min = Math.min(...levels.map((item) => Number(item.value)));
  const max = Math.max(...levels.map((item) => Number(item.value)));
  const span = max - min || 1;
  const orderedLevels = [...levels].sort((left, right) => Number(right.value) - Number(left.value));

  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Price Ladder</div>
      <div className="mt-4 flex gap-4">
        <div className="relative w-6 shrink-0 rounded-full bg-slate-800/80">
          <div className="absolute inset-x-[9px] top-2 bottom-2 rounded-full bg-slate-700/90" />
          {orderedLevels.map((item) => {
            const percent = 100 - (((Number(item.value) - min) / span) * 100);
            return (
              <div key={item.label} className="absolute inset-x-0" style={{ top: `${Math.max(6, Math.min(94, percent))}%` }}>
                <div className={`mx-auto h-3 w-3 -translate-y-1/2 rounded-full shadow-[0_0_12px_rgba(15,23,42,0.7)] ${item.tone}`} />
              </div>
            );
          })}
        </div>
        <div className="flex-1 space-y-3">
          {orderedLevels.map((item) => (
            <div key={item.label} className="flex items-center justify-between rounded-2xl border border-slate-800/70 bg-slate-950/55 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</span>
              <span className="text-sm font-semibold text-slate-100">{formatCurrency(item.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResearchDecisionPanel({ payload, currentPrice, context }) {
  const safe = payload || {
    symbol: null,
    tradeable: false,
    confidence: 20,
    setup: 'NO_SETUP',
    bias: 'NEUTRAL',
    driver: 'NO_DRIVER',
    earnings_edge: {
      label: 'NO_EDGE',
      score: 0,
      bias: 'NEUTRAL',
    },
    risk_flags: ['LOW_CONVICTION', 'NO_STRUCTURED_SETUP'],
    status: 'AVOID',
    why: 'No clean driver confirmed.',
    how: 'Wait for a cleaner setup.',
    risk: 'Avoid trading without confirmation.',
    narrative: {
      why_this_matters: 'No clean catalyst or setup is confirmed right now.',
      what_to_do: 'Wait for a clear driver, stronger volume, and a structured setup.',
      what_to_avoid: 'Avoid forcing a trade into low-conviction conditions.',
    },
  };
  const statusLabel = safe.tradeable ? 'TRADEABLE' : 'AVOID';
  const riskFlags = Array.isArray(safe.risk_flags) ? safe.risk_flags : [];
  const invalidation = buildInvalidation(safe, context?.regime);

  return (
    <Card className="overflow-hidden border-slate-800/80 bg-[linear-gradient(135deg,rgba(8,15,29,0.98),rgba(15,23,42,0.95))]">
      <CardHeader>
        <div>
          <CardTitle>Decision Panel v2</CardTitle>
          <CardDescription>
            Deterministic truth engine verdict with GPT augmentation locked to the same decision.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <DetailBlock label="Status" value={statusLabel} tone />
          <DetailBlock label="Driver" value={safe.driver} />
          <DetailBlock label="Bias" value={safe.bias} tone />
          <DetailBlock label="Confidence" value={`${safe.confidence}/100`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Why</div>
              <div className="mt-2 text-sm leading-7 text-slate-200">
                {safe.narrative?.why_this_matters || safe.why}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">How</div>
              <div className="mt-2 text-sm leading-7 text-slate-200">
                {safe.narrative?.what_to_do || safe.how}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <DetailBlock label="Setup" value={safe.setup} compact />
                <DetailBlock label="Earnings Edge" value={`${safe.earnings_edge?.label || 'NO_EDGE'} · ${safe.earnings_edge?.score ?? 0}/10`} compact />
              </div>
              <div className="mt-4">
                <HowLadder payload={safe} currentPrice={currentPrice} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Risk</div>
              <div className="mt-2 text-sm leading-7 text-slate-200">
                {safe.narrative?.what_to_avoid || safe.risk}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {riskFlags.length ? riskFlags.map((flag) => (
                  <span
                    key={flag}
                    className="rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-200"
                  >
                    {String(flag).replaceAll('_', ' ')}
                  </span>
                )) : (
                  <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-200">
                    No active risk flags
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[#2a1a1a] bg-[linear-gradient(135deg,rgba(40,15,20,0.28),rgba(14,19,32,0.7))] p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-rose-300/80">Invalidation</div>
              <div className="mt-3 space-y-3 text-sm leading-6 text-slate-200">
                {invalidation.map((item) => (
                  <div key={item} className="rounded-2xl border border-rose-950/60 bg-slate-950/35 px-4 py-3">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(ResearchDecisionPanel);