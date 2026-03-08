import { useEffect, useState } from 'react';
import { useMemo } from 'react';
import { hierarchy, treemap } from 'd3-hierarchy';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';
import TickerLogo from '../components/TickerLogo';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function signedPercent(value) {
  const num = toNumber(value);
  return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`;
}

export default function TickerHeatmap() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const width = 1000;
  const height = 540;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const payload = await apiJSON('/api/market/sector-strength');
        const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
        const next = sectors.flatMap((sector) => {
          const tickers = Array.isArray(sector?.tickers) ? sector.tickers : [];
          return tickers.map((ticker) => ({
            symbol: String(ticker?.symbol || '').toUpperCase(),
            change_percent: toNumber(ticker?.price_change ?? ticker?.change_percent),
            rvol: toNumber(ticker?.relative_volume ?? ticker?.rvol),
          }));
        });

        if (!cancelled) setRows(next.slice(0, 120));
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const layout = useMemo(() => {
    const root = hierarchy({
      children: rows.map((ticker) => {
        const absMove = Math.abs(toNumber(ticker.change_percent));
        const rvol = Math.max(toNumber(ticker.rvol), 0.1);
        return {
          ...ticker,
          value: Math.max(absMove * rvol, 0.2),
        };
      }),
    })
      .sum((node) => toNumber(node.value))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    return treemap().size([width, height]).paddingInner(3)(root).leaves();
  }, [rows]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Ticker Heatmap"
          subtitle="Logo-enhanced ticker tiles with change and relative volume."
        />
      </Card>

      <Card>
        {loading ? (
          <LoadingSpinner message="Loading ticker heatmap..." />
        ) : !rows.length ? (
          <div className="muted">No ticker heatmap data available.</div>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} className="h-[440px] w-full rounded border border-[var(--border-color)] bg-[var(--bg-card)]">
            {layout.map((node) => {
              const w = Math.max(0, node.x1 - node.x0);
              const h = Math.max(0, node.y1 - node.y0);
              if (w < 10 || h < 10) return null;

              const ticker = node.data;
              const fontSize = clamp(w * 0.18, 10, 18);
              const detailSize = clamp(fontSize * 0.78, 10, 14);
              const showLogo = w > 90;

              return (
                <g key={ticker.symbol}>
                  <rect
                    x={node.x0}
                    y={node.y0}
                    width={w}
                    height={h}
                    fill={toNumber(ticker.change_percent) >= 0 ? 'rgba(16,185,129,0.36)' : 'rgba(239,68,68,0.36)'}
                    stroke="rgba(255,255,255,0.16)"
                  />
                  <foreignObject x={node.x0 + 2} y={node.y0 + 2} width={w - 4} height={h - 4}>
                    <div className="ticker-tile" style={{ pointerEvents: 'none' }}>
                      {showLogo && <TickerLogo symbol={ticker.symbol} />}
                      <div className="ticker-symbol" style={{ fontSize: `${fontSize}px` }}>{ticker.symbol}</div>
                      <div className="ticker-change" style={{ fontSize: `${detailSize}px` }}>{signedPercent(ticker.change_percent)}</div>
                      <div className="ticker-rvol" style={{ fontSize: `${detailSize}px` }}>RVOL {toNumber(ticker.rvol).toFixed(2)}</div>
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>
        )}
      </Card>
    </PageContainer>
  );
}
