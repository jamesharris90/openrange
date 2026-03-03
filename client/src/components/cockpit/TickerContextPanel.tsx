import React from 'react';

type ContextProps = {
  volumeDelta: number | null;
  rvolDelta: number | null;
  distanceFromVwapPercent: number | null;
  expectedMoveVsCurrentPrice: number | null;
  intelligenceClassification: string;
  newsScore: number;
};

function fmt(value: number | null, digits = 2): string {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
}

export default function TickerContextPanel({
  volumeDelta,
  rvolDelta,
  distanceFromVwapPercent,
  expectedMoveVsCurrentPrice,
  intelligenceClassification,
  newsScore,
}: ContextProps) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-2 text-xs md:grid-cols-3">
      <div>Vol Δ: <span className="font-semibold">{fmt(volumeDelta, 0)}</span></div>
      <div>RVOL Δ: <span className="font-semibold">{fmt(rvolDelta, 2)}</span></div>
      <div>Dist VWAP %: <span className="font-semibold">{fmt(distanceFromVwapPercent, 2)}</span></div>
      <div>Expected Move: <span className="font-semibold">{fmt(expectedMoveVsCurrentPrice, 2)}</span></div>
      <div>Classification: <span className="font-semibold">{intelligenceClassification || '—'}</span></div>
      <div>News Score: <span className="font-semibold">{Number.isFinite(newsScore) ? newsScore : '—'}</span></div>
    </div>
  );
}
