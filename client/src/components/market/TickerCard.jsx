function miniSeries(price, changePercent) {
  const p = Number(price || 0);
  const c = Number(changePercent || 0) / 100;
  if (!Number.isFinite(p) || p <= 0) return [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const start = p * (1 - c);
  return [
    start,
    start + (p - start) * 0.15,
    start + (p - start) * 0.35,
    start + (p - start) * 0.55,
    start + (p - start) * 0.78,
    p,
  ];
}

function Sparkline({ price, changePercent }) {
  const points = miniSeries(price, changePercent);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const normalized = points.map((value, index) => {
    const x = (index / (points.length - 1)) * 100;
    const y = 30 - ((value - min) / span) * 24;
    return `${x},${y}`;
  }).join(' ');
  const up = Number(changePercent || 0) >= 0;

  return (
    <svg viewBox="0 0 100 30" className="h-7 w-full">
      <polyline
        fill="none"
        stroke={up ? '#10b981' : '#f43f5e'}
        strokeWidth="2"
        points={normalized}
      />
    </svg>
  );
}

export default function TickerCard({ row }) {
  const symbol = String(row?.symbol || '--').toUpperCase();
  const price = Number(row?.price || 0);
  const change = Number(row?.change_percent || 0);
  const up = change >= 0;

  return (
    <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
      <div className="flex items-center justify-between">
        <strong>{symbol}</strong>
        <span className={up ? 'text-emerald-400' : 'text-rose-400'}>{up ? '▲' : '▼'}</span>
      </div>
      <div className="mt-1 text-lg font-semibold">{Number.isFinite(price) ? price.toFixed(2) : '--'}</div>
      <div className={`text-sm ${up ? 'text-emerald-400' : 'text-rose-400'}`}>{up ? '+' : ''}{change.toFixed(2)}%</div>
      <div className="mt-2"><Sparkline price={price} changePercent={change} /></div>
    </div>
  );
}
