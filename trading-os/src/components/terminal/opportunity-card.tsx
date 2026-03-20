import type { Opportunity } from "@/lib/types";

import { normalizeSymbolForUI } from "@/lib/symbol-normalizer";

type OpportunityCardProps = {
  data: Opportunity;
};

function valueOrDash(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value;
  return "-";
}

export function OpportunityCard({ data }: OpportunityCardProps) {
  return (
    <div className="rounded-lg border border-slate-800 p-3">
      <div className="text-lg font-bold text-slate-100">{normalizeSymbolForUI(String(data.symbol || ""))}</div>
      <div className="text-sm text-slate-300">{valueOrDash(data.strategy)}</div>
      <div className="mt-2 grid gap-2 text-xs md:grid-cols-5">
        <div className="text-slate-300">Entry: {valueOrDash(data.entry)}</div>
        <div className="text-slate-300">Stop Loss: {valueOrDash(data.stop_loss)}</div>
        <div className="text-slate-300">Take Profit: {valueOrDash(data.take_profit)}</div>
        <div className="text-slate-300">Expected Move %: {valueOrDash(data.expected_move_percent)}</div>
        <div className="text-slate-300">Confidence: {valueOrDash(data.confidence)}</div>
      </div>
    </div>
  );
}
