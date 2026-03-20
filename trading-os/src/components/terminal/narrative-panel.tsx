import type { Opportunity } from "@/lib/types";
import { percentSafe } from "@/lib/number";

export function NarrativePanel({ ticker, opportunity }: { ticker: string; opportunity?: Opportunity }) {
  const probability = Number.isFinite(opportunity?.probability as number) ? (opportunity?.probability as number) : Number.NaN;
  const confidence = Number.isFinite(opportunity?.confidence as number) ? (opportunity?.confidence as number) : Number.NaN;
  const expectedMove = Number.isFinite(opportunity?.expected_move as number) ? (opportunity?.expected_move as number) : Number.NaN;

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">AI Narrative</div>
      <p className="text-sm leading-6 text-slate-200">
        {ticker} remains above key trend support while participation expands. Opportunity flow suggests continued attention in this name with
        catalyst alignment and positive strategy posture.
      </p>
      <div className="mt-3 space-y-1 text-xs text-slate-300">
        <div>Probability of continuation: {Number.isFinite(probability) ? `${probability}%` : "Unavailable"}</div>
        <div>Confidence score: {Number.isFinite(confidence) ? `${confidence}%` : "Unavailable"}</div>
        <div>Expected move: {Number.isFinite(expectedMove) ? percentSafe(expectedMove, 2) : "Unavailable"}</div>
      </div>
    </div>
  );
}
