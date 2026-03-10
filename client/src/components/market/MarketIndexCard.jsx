import TickerLink from '../shared/TickerLink';

function miniSeries(price, changePercent) {
  const p = Number(price || 0);
  const c = Number(changePercent || 0) / 100;
  if (!Number.isFinite(p) || p <= 0) return [0.5, 0.6, 0.55, 0.62, 0.57, 0.64];
  const start = p * (1 - c);
  return [
    start,
    start + (p - start) * 0.2,
    start + (p - start) * 0.35,
    start + (p - start) * 0.55,
    start + (p - start) * 0.8,
    p,
  ];
}

function Sparkline({ price, changePercent }) {
  const points = miniSeries(price, changePercent);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const normalized = points.map((value, idx) => {
    const x = (idx / (points.length - 1)) * 100;
    const y = 30 - ((value - min) / span) * 24;
    return `${x},${y}`;
  }).join(' ');

  const up = Number(changePercent || 0) >= 0;

  return (
    <svg viewBox="0 0 100 30" className="h-7 w-full">
      <polyline
        fill="none"
        stroke={up ? '#10b981' : '#ef4444'}
        strokeWidth="2"
        points={normalized}
      />
    </svg>
  );
}

export default function MarketIndexCard({ row }) {
  const symbol = String(row?.symbol || '--').toUpperCase();
  const price = Number(row?.price);
  const change = Number(row?.change_percent ?? row?.changePercent ?? row?.percent);
  const hasPrice = Number.isFinite(price);
  const hasChange = Number.isFinite(change);
  const up = hasChange ? change >= 0 : true;

  return (
    <article className="or-card-ui">
      <div className="flex items-center justify-between">
        <TickerLink symbol={symbol} className="text-sm font-semibold" />
        <span className={`text-xs ${hasChange ? (up ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-400'}`}>{hasChange ? (up ? '▲' : '▼') : '•'}</span>
      </div>
      <div className="mt-1 text-lg font-semibold">{hasPrice ? price.toFixed(2) : '--'}</div>
      <div className={`text-xs ${hasChange ? (up ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-400'}`}>{hasChange ? `${up ? '+' : ''}${change.toFixed(2)}%` : '--'}</div>
      <div className="mt-2"><Sparkline price={hasPrice ? price : null} changePercent={hasChange ? change : null} /></div>
    </article>
  );
}
