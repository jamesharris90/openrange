import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';

function fmtPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
}

function fmtPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('en-US');
}

function buildPath(points, width, height) {
  if (!points.length) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;

  return points
    .map((value, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

export default function TickerHoverPanel({ symbol, detail }) {
  const [miniPoints, setMiniPoints] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadMini() {
      if (!symbol) return;
      try {
        const payload = await apiJSON(`/api/market/chart-mini/${encodeURIComponent(symbol)}`);
        if (cancelled) return;
        const points = Array.isArray(payload)
          ? payload.map((row) => Number(row?.value)).filter((value) => Number.isFinite(value))
          : [];
        setMiniPoints(points);
      } catch (_error) {
        if (!cancelled) setMiniPoints([]);
      }
    }

    loadMini();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const miniPath = useMemo(() => buildPath(miniPoints, 248, 42), [miniPoints]);
  const isUp = Number(detail?.changesPercentage) >= 0;

  return (
    <div className="pointer-events-none absolute left-3 top-full z-50 mt-1 w-72 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{symbol}</div>
        <div className="text-sm text-[var(--text-secondary)]">{fmtPrice(detail?.price)}</div>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-[var(--text-muted)]">Change</span>
        <span className={isUp ? 'text-emerald-400' : 'text-rose-400'}>{fmtPercent(detail?.changesPercentage)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-[var(--text-muted)]">Volume</span>
        <span>{fmtVolume(detail?.volume)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-[var(--text-muted)]">Sector</span>
        <span>{detail?.sector || '--'}</span>
      </div>

      <div className="mt-2 h-[42px]">
        {miniPoints.length >= 2 ? (
          <svg width="248" height="42" viewBox="0 0 248 42" role="img" aria-label={`mini chart ${symbol}`}>
            <path
              d={miniPath}
              fill="none"
              stroke={isUp ? 'var(--positive, #16a34a)' : 'var(--negative, #dc2626)'}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <div className="text-[10px] text-[var(--text-muted)]">Data temporarily unavailable</div>
        )}
      </div>
    </div>
  );
}
