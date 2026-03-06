import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';

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

export default function MiniSymbolChart({ symbol, width = 160, height = 42 }) {
  const [candles, setCandles] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!symbol) return;
      try {
        const payload = await apiJSON(`/api/chart/mini/${encodeURIComponent(symbol)}`);
        if (cancelled) return;
        if (Array.isArray(payload)) {
          setCandles(payload.map((row) => ({ close: Number(row?.value) })).filter((row) => Number.isFinite(row.close)));
        } else {
          setCandles(Array.isArray(payload?.candles) ? payload.candles : []);
        }
      } catch {
        if (!cancelled) setCandles([]);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const values = useMemo(
    () => candles.map((candle) => Number(candle?.close)).filter((value) => Number.isFinite(value)).slice(-50),
    [candles]
  );

  if (values.length < 2) {
    return <div className="h-[42px] text-[10px] text-[var(--text-muted)]">No mini chart</div>;
  }

  const path = buildPath(values, width, height);
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? 'var(--positive, #16a34a)' : 'var(--negative, #dc2626)';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`mini chart ${symbol}`}>
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
