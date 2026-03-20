import { memo } from 'react';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ExpectedMoveBar({ currentPrice, expectedRange }) {
  const low = Number(expectedRange?.low);
  const high = Number(expectedRange?.high);
  const current = Number(currentPrice);

  const hasRange = Number.isFinite(low) && Number.isFinite(high) && high > low;
  const hasCurrent = Number.isFinite(current);

  if (!hasRange || !hasCurrent) {
    console.warn('[ExpectedMoveBar] missing required fields', {
      currentPrice,
      expectedRange,
    });

    return (
      <div className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-400">
        Expected move range: N/A
      </div>
    );
  }

  const position = clamp(((current - low) / (high - low)) * 100, 0, 100);
  const toneClass = position < 20 ? 'bg-rose-500' : position > 80 ? 'bg-emerald-500' : 'bg-amber-400';

  return (
    <div className="space-y-1">
      <div className="h-2 rounded-full bg-slate-800" aria-label="expected-move-range">
        <div className="relative h-full w-full">
          <div className="absolute inset-0 rounded-full bg-slate-700" />
          <div
            className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-slate-900 ${toneClass}`}
            style={{ left: `${position}%`, transform: 'translate(-50%, -50%)' }}
          />
        </div>
      </div>
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>{low.toFixed(2)}</span>
        <span>{high.toFixed(2)}</span>
      </div>
    </div>
  );
}

export default memo(ExpectedMoveBar);
