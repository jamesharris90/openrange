export function ProbabilityBar({ value }: { value: number }) {
  const normalized = Math.max(0, Math.min(100, value));

  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Probability</div>
      <div className="mb-2 flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full bg-blue-500" style={{ width: `${normalized}%` }} />
      </div>
      <div className="text-sm font-medium text-slate-100">{normalized.toFixed(0)}%</div>
    </div>
  );
}
