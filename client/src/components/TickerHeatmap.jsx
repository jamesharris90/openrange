import { useMemo } from 'react';
import { hierarchy, treemap } from 'd3-hierarchy';
import TickerTile from './TickerTile';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function TickerHeatmap({ tickers = [], width = 1000, height = 540 }) {
  const layout = useMemo(() => {
    const root = hierarchy({
      children: (Array.isArray(tickers) ? tickers : []).map((ticker) => {
        const symbol = String(ticker?.symbol || '?').toUpperCase();
        const change = toNumber(ticker?.change ?? ticker?.change_percent);
        const rvol = toNumber(ticker?.rvol ?? ticker?.relative_volume);
        const size = toNumber(ticker?.marketCap ?? ticker?.volume ?? ticker?.size);
        const value = Math.max(size || Math.abs(change) * Math.max(rvol, 0.1), 0.2);
        return {
          symbol,
          change,
          rvol,
          value,
        };
      }),
    })
      .sum((node) => toNumber(node.value))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    return treemap().size([width, height]).paddingInner(3)(root).leaves();
  }, [tickers, width, height]);

  if (!tickers.length) {
    return <div className="empty-state">Market data loading...</div>;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[440px] w-full rounded border border-[var(--border-color)] bg-[var(--bg-card)]">
      {layout.map((node) => {
        const w = Math.max(0, node.x1 - node.x0);
        const h = Math.max(0, node.y1 - node.y0);
        if (w < 10 || h < 10) return null;

        const ticker = node.data;

        return (
          <g key={`${ticker.symbol}-${node.x0}-${node.y0}`}>
            <rect
              x={node.x0}
              y={node.y0}
              width={w}
              height={h}
              fill={toNumber(ticker.change) >= 0 ? 'rgba(16,185,129,0.36)' : 'rgba(239,68,68,0.36)'}
              stroke="rgba(255,255,255,0.16)"
            />
            <TickerTile
              x={node.x0 + 2}
              y={node.y0 + 2}
              width={w - 4}
              height={h - 4}
              symbol={ticker.symbol || '?'}
              change={ticker.change || 0}
              rvol={ticker.rvol || 0}
            />
          </g>
        );
      })}
    </svg>
  );
}
