"use client";

import InsightBlock from "@/components/research/InsightBlock";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function toneForGrade(value) {
  if (value === "A") return "text-emerald-300";
  if (value === "B") return "text-sky-300";
  if (value === "C") return "text-amber-300";
  return "text-rose-300";
}

function toneForPercent(value) {
  if (value >= 80) return "text-emerald-300";
  if (value >= 60) return "text-amber-300";
  return "text-rose-300";
}

function formatNumber(value, digits = 0, suffix = "") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "—";
  }

  return `${numeric.toFixed(digits)}${suffix}`;
}

function ScoreTile({ label, value, tone = "text-slate-100", detail = null }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</div>
      {detail ? <div className="mt-2 text-sm text-slate-400">{detail}</div> : null}
    </div>
  );
}

function buildScoreRead(score) {
  if (Number(score.final_score || 0) >= 70 && Number(score.data_confidence || 0) >= 70) {
    return "Score quality and data confidence are aligned. Use the research narrative and execution plan to decide if the setup deserves action.";
  }

  if (Number(score.tqi || 0) >= 65 && Number(score.data_confidence || 0) < 60) {
    return "Setup quality is present, but the data layer is still weak. Treat the ticker as interesting, not verified, until coverage improves.";
  }

  return "Use this tab as the score ledger for the ticker. The screener now handles discovery while score validation lives here with the rest of the research context.";
}

export default function ScoreTab({ symbol, terminal }) {
  const score = terminal?.score || {};
  const coverageScore = Number(score.coverage_score ?? terminal?.coverage?.coverage_score ?? 0);
  const dataConfidence = Number(score.data_confidence ?? terminal?.data_confidence ?? 0);
  const finalScore = Number(score.final_score || 0);
  const tqi = Number(score.tqi || 0);
  const freshnessScore = Number(terminal?.freshness_score || 0);
  const sourceQuality = Number(terminal?.source_quality || 0);

  return (
    <div className="space-y-4">
      <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Score Ledger</CardTitle>
          <CardDescription>Per-ticker score, trust, and coverage context moved off the scanner and into research.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <ScoreTile label="Score" value={formatNumber(finalScore, 2)} tone={toneForPercent(finalScore)} />
          <ScoreTile label="TQI" value={formatNumber(tqi, 0)} tone={toneForPercent(tqi)} />
          <ScoreTile label="Grade" value={score.tqi_label || "D"} tone={toneForGrade(score.tqi_label || "D")} />
          <ScoreTile label="Coverage" value={formatNumber(coverageScore, 0, "%")} tone={toneForPercent(coverageScore)} />
          <ScoreTile label="DCS" value={formatNumber(dataConfidence, 0, "%")} tone={toneForPercent(dataConfidence)} detail={score.data_confidence_label || terminal?.data_confidence_label || "POOR"} />
        </CardContent>
      </Card>

      <Card className="border-slate-800/80 bg-slate-950/50">
        <CardHeader>
          <CardTitle>Trust Breakdown</CardTitle>
          <CardDescription>Data confidence is still driven by coverage, freshness, and source quality.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <ScoreTile label="Freshness" value={formatNumber(freshnessScore, 0)} tone={toneForPercent(freshnessScore)} />
          <ScoreTile label="Source Quality" value={formatNumber(sourceQuality, 0)} tone={toneForPercent(sourceQuality)} />
          <ScoreTile label="Tradeable" value={score.tradeable ? "Yes" : "No"} tone={score.tradeable ? "text-emerald-300" : "text-slate-300"} detail={symbol ? `${symbol} research score state` : null} />
        </CardContent>
      </Card>

      <InsightBlock title="Score Read" body={buildScoreRead({ final_score: finalScore, tqi, data_confidence: dataConfidence })} />
    </div>
  );
}