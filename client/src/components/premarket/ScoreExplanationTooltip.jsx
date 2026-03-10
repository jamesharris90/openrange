export default function ScoreExplanationTooltip({ row }) {
  const score = Number(row?.strategy_score ?? row?.score ?? 0) || 0;
  const rvol = Number(row?.relative_volume ?? row?.rvol ?? 0) || 0;
  const gap = Math.abs(Number(row?.gap_percent ?? row?.gap ?? 0) || 0);

  const breakdown = [
    { label: 'Relative Volume', value: Math.round(rvol * 120) },
    { label: 'Gap Size', value: Math.round(gap * 60) },
    { label: 'Strategy Strength', value: Math.round(score * 0.22) },
    { label: 'Sector Momentum', value: Math.round((score * 0.12)) },
    { label: 'News Catalyst', value: Math.round((score * 0.1)) },
  ];

  return (
    <div className="invisible absolute left-0 top-full z-20 mt-2 w-64 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-xs opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100">
      <div className="mb-2 font-semibold">Score: {Math.round(score)}</div>
      <div className="space-y-1">
        {breakdown.map((item) => (
          <div key={item.label} className="flex items-center justify-between">
            <span className="text-[var(--text-muted)]">{item.label}</span>
            <span>+{item.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-[var(--border-color)] pt-2 font-semibold">Total: {Math.round(score)}</div>
    </div>
  );
}
