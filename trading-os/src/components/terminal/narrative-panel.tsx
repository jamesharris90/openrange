import type { Opportunity } from "@/lib/types";

export function NarrativePanel({ ticker, opportunity }: { ticker: string; opportunity?: Opportunity }) {
  const probability = opportunity?.probability ?? 64;
  const confidence = opportunity?.confidence ?? 71;

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">AI Narrative</div>
      <p className="text-sm leading-6 text-slate-200">
        {ticker} remains above key trend support while participation expands. Opportunity flow suggests continued attention in this name with
        catalyst alignment and positive strategy posture.
      </p>
      <div className="mt-3 space-y-1 text-xs text-slate-300">
        <div>Probability of continuation: {probability}%</div>
        <div>Confidence score: {confidence}%</div>
        <div>Expected move: {(opportunity?.expected_move ?? 2.6).toFixed(2)}%</div>
      </div>
    </div>
  );
}
