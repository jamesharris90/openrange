import { percentSafe, toFixedSafe, toNumber } from "@/lib/number";

export function ExpectedMoveChip({
  label = "Expected Move",
  percent,
  dollars,
}: {
  label?: string;
  percent: number;
  dollars?: number;
}) {
  const safePercent = toNumber(percent, Number.NaN);
  const safeDollars = toNumber(dollars, Number.NaN);
  const tone = Number.isFinite(safePercent) && Math.abs(safePercent) >= 4 ? "text-amber-300" : "text-emerald-300";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-sm font-semibold ${tone}`}>{Number.isFinite(safePercent) ? percentSafe(safePercent, 2) : "Unavailable"}</div>
      {Number.isFinite(safeDollars) ? <div className="text-[11px] text-slate-400">${toFixedSafe(safeDollars, 2)}</div> : null}
    </div>
  );
}
