"use client";

import { cn } from "@/lib/utils";

const TONE_STYLES = {
  positive: "border-emerald-500/25 bg-emerald-500/10 text-emerald-50",
  negative: "border-rose-500/25 bg-rose-500/10 text-rose-50",
  neutral: "border-slate-700/80 bg-slate-950/55 text-slate-100",
};

export default function InsightBlock({ title, body, tone = "neutral" }) {
  return (
    <div className={cn("rounded-3xl border p-5", TONE_STYLES[tone] || TONE_STYLES.neutral)}>
      <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{title}</div>
      <p className="mt-3 text-sm leading-6 text-inherit">{body}</p>
    </div>
  );
}