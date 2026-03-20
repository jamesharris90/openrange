import { toFixedSafe, toNumber } from "@/lib/number";

export function ProbabilityBar({ value }: { value: number }) {
  const normalized = Math.max(0, Math.min(100, toNumber(value, 0)));
  const tone = normalized >= 60 ? "bg-emerald-500" : normalized <= 40 ? "bg-rose-500" : "bg-amber-400";

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Probability</div>
      <div className="mb-2 flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${tone}`} style={{ width: `${normalized}%` }} />
      </div>
      <div className="text-sm font-medium text-slate-100">{toFixedSafe(normalized, 0)}%</div>
    </div>
  );
}
