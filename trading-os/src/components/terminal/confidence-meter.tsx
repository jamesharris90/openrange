import { toFixedSafe, toNumber } from "@/lib/number";

export function ConfidenceMeter({ value }: { value: number }) {
  const normalized = Math.max(0, Math.min(100, toNumber(value, 0)));
  const color = normalized >= 75 ? "bg-emerald-500" : normalized >= 50 ? "bg-amber-400" : "bg-rose-500";

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Confidence</div>
      <div className="mb-2 h-3 w-full rounded-full bg-slate-800">
        <div className={`h-3 rounded-full ${color}`} style={{ width: `${normalized}%` }} />
      </div>
      <div className="text-sm font-medium text-slate-100">{toFixedSafe(normalized, 0)}%</div>
    </div>
  );
}
