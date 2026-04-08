"use client";

import { Card, CardContent } from "@/components/ui/card";

function scoreTone(score) {
  if (score >= 7) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (score >= 4) return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-rose-500/30 bg-rose-500/10 text-rose-200";
}

function confidenceTone(confidence) {
  if (confidence === "HIGH") return "text-emerald-300";
  if (confidence === "MEDIUM") return "text-amber-300";
  return "text-rose-300";
}

export default function DecisionBanner({ decision }) {
  const tradeScore = Number(decision?.tradeScore || 0);
  const confidence = String(decision?.confidence || "LOW").toUpperCase();
  const message = String(decision?.message || "Low conviction — avoid");

  return (
    <Card className="border-slate-800/80 bg-[linear-gradient(135deg,rgba(8,15,29,0.98),rgba(15,23,42,0.94))]">
      <CardContent className="grid gap-4 p-6 md:grid-cols-[1.1fr_0.9fr_2fr] md:items-center">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Decision Engine</div>
          <div className="mt-2 text-3xl font-semibold text-slate-50">Trade Score {tradeScore}/10</div>
        </div>

        <div className={`inline-flex w-fit rounded-full border px-4 py-2 text-sm font-semibold tracking-[0.18em] ${scoreTone(tradeScore)}`}>
          <span className={confidenceTone(confidence)}>{confidence}</span>
        </div>

        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/45 px-4 py-4 text-sm leading-6 text-slate-200">
          {message}
        </div>
      </CardContent>
    </Card>
  );
}
