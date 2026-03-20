import { memo } from 'react';

function Sparkline({ values = [] }) {
  if (!Array.isArray(values) || values.length < 2) {
    return <div className="h-8 rounded bg-slate-800/70" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = 120 / (values.length - 1);
  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = 32 - ((value - min) / range) * 32;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 120 32" className="h-8 w-full" preserveAspectRatio="none">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-300" points={points} />
    </svg>
  );
}

export function countTopOpportunities(opportunities = []) {
  if (!Array.isArray(opportunities)) return 0;
  return opportunities.reduce((count, row) => {
    const confidence = Number(row?.confidence);
    return Number.isFinite(confidence) && confidence > 70 ? count + 1 : count;
  }, 0);
}

function toneClass(tone) {
  if (tone === 'positive') return 'border-emerald-500/50';
  if (tone === 'negative') return 'border-rose-500/50';
  if (tone === 'warning') return 'border-amber-400/50';
  return 'border-slate-700';
}

function KPICard({
  title,
  value,
  previousValue,
  sparkline = [],
  tone = 'neutral',
}) {
  const current = Number(value);
  const previous = Number(previousValue);
  const hasCurrent = Number.isFinite(current);
  const hasPrevious = Number.isFinite(previous);
  const delta = hasCurrent && hasPrevious ? current - previous : null;

  return (
    <article className={`rounded-xl border bg-slate-900/50 p-3 ${toneClass(tone)}`}>
      <div className="text-xs uppercase tracking-wide text-slate-400">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{hasCurrent ? current.toLocaleString() : 'N/A'}</div>
      <div className="mt-1 text-xs text-slate-400">
        Delta: {delta === null ? 'N/A' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`}
      </div>
      <div className="mt-2">
        <Sparkline values={sparkline} />
      </div>
    </article>
  );
}

export default memo(KPICard);
