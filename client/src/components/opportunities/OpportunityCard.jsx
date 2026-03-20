import { memo } from 'react';

import ExpectedMoveBar from '../ui/ExpectedMoveBar';

function gaugeTone(confidence) {
  if (!Number.isFinite(confidence)) return 'bg-slate-600';
  if (confidence >= 80) return 'bg-emerald-500';
  if (confidence >= 60) return 'bg-amber-400';
  return 'bg-rose-500';
}

function OpportunityCard({ opportunity, maxConfidence = 100, currentPrice, expectedMoveRange }) {
  const symbol = String(opportunity?.symbol || '');
  const strategy = String(opportunity?.strategy || 'N/A');
  const confidence = Number(opportunity?.confidence);
  const catalyst = opportunity?.catalyst;

  if (!opportunity?.symbol || !opportunity?.strategy || !Number.isFinite(confidence)) {
    console.warn('[OpportunityCard] missing required opportunity fields', opportunity);
  }

  if (!catalyst) {
    console.warn('[OpportunityCard] missing catalyst field', { symbol });
  }

  const sizeScale = Number.isFinite(confidence) && Number.isFinite(maxConfidence) && maxConfidence > 0
    ? 0.92 + (Math.max(0, confidence) / maxConfidence) * 0.16
    : 1;

  return (
    <article
      className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"
      style={{ transform: `scale(${sizeScale.toFixed(3)})`, transformOrigin: 'center top' }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-mono text-sm text-slate-100">{symbol || 'N/A'}</div>
        <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200">
          {strategy}
        </span>
      </div>

      <div className="mb-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Confidence</div>
        <div className="h-2 rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full ${gaugeTone(confidence)}`}
            style={{ width: `${Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0}%` }}
          />
        </div>
      </div>

      <div className="mb-2 text-xs text-slate-300">
        Catalyst: <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200">{catalyst || 'N/A'}</span>
      </div>

      <ExpectedMoveBar
        currentPrice={currentPrice}
        expectedRange={expectedMoveRange}
      />
    </article>
  );
}

export default memo(OpportunityCard);
