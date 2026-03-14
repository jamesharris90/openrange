import { memo } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

function Sparkline({ data = [] }) {
  if (!Array.isArray(data) || data.length < 2) {
    return <div className="h-10 rounded bg-slate-800/80" />;
  }

  const width = 160;
  const height = 40;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-10 w-full" preserveAspectRatio="none" role="img" aria-label="sparkline">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-blue-400"
        points={points}
      />
    </svg>
  );
}

function KPICard({ title, value, trend, trendDirection = 'up', icon: Icon, sparklineData = [] }) {
  const isUp = trendDirection !== 'down';
  const TrendIcon = isUp ? TrendingUp : TrendingDown;
  const trendClass = isUp ? 'text-green-400' : 'text-red-400';

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4 transition hover:shadow-lg hover:shadow-slate-950/40">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">{title}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-100">{value}</p>
        </div>
        {Icon ? (
          <span className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-blue-400">
            <Icon size={18} />
          </span>
        ) : null}
      </div>
      <div className={`mb-2 flex items-center gap-1 text-xs font-medium ${trendClass}`}>
        <TrendIcon size={14} />
        <span>{trend}</span>
      </div>
      <Sparkline data={sparklineData} />
    </article>
  );
}

export default memo(KPICard);
