import React from 'react';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function ConfidenceGauge({ value }) {
  const numeric = Number(value);
  const percent = Number.isFinite(numeric) ? clamp(numeric > 1 ? numeric : numeric * 100, 0, 100) : 0;
  const segments = [20, 40, 60, 80, 100];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>Confidence</span>
        <span className="font-semibold text-cyan-300">{percent.toFixed(0)}%</span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {segments.map((threshold) => (
          <div
            key={threshold}
            className={`h-2 rounded-sm ${
              percent >= threshold
                ? threshold <= 40
                  ? 'bg-rose-500'
                  : threshold <= 80
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
                : 'bg-slate-700'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export function ExpectedMoveRange({ low, high, current }) {
  const lowNum = Number(low);
  const highNum = Number(high);
  const currentNum = Number(current);

  if (!Number.isFinite(lowNum) || !Number.isFinite(highNum) || highNum <= lowNum) {
    return <div className="text-[11px] text-slate-500">No qualifying setups right now</div>;
  }

  const midpoint = (lowNum + highNum) / 2;
  const pct = Number.isFinite(currentNum) ? ((currentNum - lowNum) / (highNum - lowNum)) * 100 : 50;
  const clampedPct = clamp(pct, 0, 100);
  const dotClass = clampedPct >= 65 ? 'bg-emerald-400' : clampedPct <= 35 ? 'bg-rose-400' : 'bg-slate-300';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>Expected Range</span>
        <span>{lowNum.toFixed(2)} - {highNum.toFixed(2)}</span>
      </div>
      <div className="relative h-3 rounded bg-slate-800">
        <div className="absolute left-0 top-1/2 h-[2px] w-full -translate-y-1/2 bg-slate-500" />
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-300 bg-slate-400" />
        <div className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-900 ${dotClass}`} style={{ left: `${clampedPct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>L {lowNum.toFixed(2)}</span>
        <span>M {midpoint.toFixed(2)}</span>
        <span>H {highNum.toFixed(2)}</span>
      </div>
    </div>
  );
}

export function SentimentBadge({ value }) {
  const raw = String(value || '').toLowerCase();
  const isBull = raw.includes('bull') || raw.includes('positive') || raw.includes('up');
  const isBear = raw.includes('bear') || raw.includes('negative') || raw.includes('down');

  const className = isBull
    ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
    : isBear
      ? 'border-rose-500/30 bg-rose-500/15 text-rose-300'
      : 'border-amber-500/30 bg-amber-500/15 text-amber-300';

  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className}`}>
      {value || 'Neutral'}
    </span>
  );
}
