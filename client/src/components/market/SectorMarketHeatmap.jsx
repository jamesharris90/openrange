import { useMemo, useState } from 'react';
import { hierarchy, treemap } from 'd3-hierarchy';
import TickerLink from '../shared/TickerLink';
import TickerTile from '../TickerTile';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function colorForNode(relativeVolume, priceChange) {
  const rv = toNumber(relativeVolume);
  const move = toNumber(priceChange);
  const intensity = Math.min(1, Math.abs(move) / 5 + rv / 6);

  if (move >= 0) {
    return `rgba(16, 185, 129, ${0.25 + intensity * 0.45})`;
  }
  return `rgba(239, 68, 68, ${0.25 + intensity * 0.45})`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatSignedPercent(value) {
  const num = toNumber(value);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

export default function SectorMarketHeatmap({ sectors = [], width = 1000, height = 520 }) {
  const [expandedSector, setExpandedSector] = useState('');

  const sectorLayout = useMemo(() => {
    const root = hierarchy({
      children: sectors?.map((sector) => ({
        name: sector?.sector || 'Unknown',
        value: Math.max(toNumber(sector?.market_cap), 1),
        relative_volume: toNumber(sector?.relative_volume),
        price_change: toNumber(sector?.price_change),
      })),
    })
      .sum((node) => toNumber(node.value))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    return treemap().size([width, height]).paddingInner(4)(root).leaves();
  }, [height, sectors, width]);

  const expandedTickers = useMemo(() => {
    const selected = sectors.find((item) => String(item?.sector || '') === expandedSector);
    const tickers = Array.isArray(selected?.tickers) ? selected.tickers : [];

    const root = hierarchy({
      children: tickers?.map((ticker) => ({
        name: String(ticker?.symbol || ''),
        value: Math.max(toNumber(ticker?.volume || ticker?.relative_volume), 1),
        relative_volume: toNumber(ticker?.relative_volume),
        price_change: toNumber(ticker?.price_change),
      })),
    })
      .sum((node) => toNumber(node.value))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    return treemap().size([width, height]).paddingInner(3)(root).leaves();
  }, [expandedSector, height, sectors, width]);

  if (!sectors.length) {
    return <div className="muted">No sector-strength data available.</div>;
  }

  if (expandedSector) {
    return (
      <div>
        <div className="flex items-center justify-between px-4 py-2">
          <h4 className="m-0 text-sm">{expandedSector} Ticker Heatmap</h4>
          <button
            type="button"
            onClick={() => setExpandedSector('')}
            className="rounded border border-[var(--border-color)] px-2 py-1 text-xs hover:bg-[var(--bg-card-hover)]"
          >
            Back to Sectors
          </button>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="h-[480px] w-full block">
          {expandedTickers?.map((node) => {
            const w = Math.max(0, node.x1 - node.x0);
            const h = Math.max(0, node.y1 - node.y0);
            if (w < 10 || h < 10) return null;
            const symbol = String(node.data?.name || '').toUpperCase();
            return (
              <g key={symbol}>
                <rect x={node.x0} y={node.y0} width={w} height={h} fill={colorForNode(node.data?.relative_volume, node.data?.price_change)} stroke="rgba(255,255,255,0.15)" />
                <TickerTile
                  x={node.x0 + 2}
                  y={node.y0 + 2}
                  width={w - 4}
                  height={h - 4}
                  symbol={symbol}
                  change={toNumber(node.data?.price_change)}
                  rvol={toNumber(node.data?.relative_volume)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[480px] w-full block">
      {sectorLayout?.map((node) => {
        const w = Math.max(0, node.x1 - node.x0);
        const h = Math.max(0, node.y1 - node.y0);
        if (w < 16 || h < 16) return null;
        const sectorName = String(node.data?.name || 'Unknown');
        const hideLabel = w < 40;
        const fontSize = clamp(w * 0.16, 12, 36);
        const detailSize = clamp(fontSize * 0.46, 11, 16);
        const insetX = w * 0.025;
        const insetY = h * 0.025;

        return (
          <g key={sectorName} onClick={() => setExpandedSector(sectorName)} className="cursor-pointer">
            <rect x={node.x0} y={node.y0} width={w} height={h} fill={colorForNode(node.data?.relative_volume, node.data?.price_change)} stroke="rgba(255,255,255,0.16)" />
            {!hideLabel && (
              <foreignObject
                x={node.x0 + insetX}
                y={node.y0 + insetY}
                width={w * 0.95}
                height={h * 0.95}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    lineHeight: 1.08,
                    color: 'var(--text-primary)',
                    pointerEvents: 'none',
                  }}
                >
                  <div
                    style={{
                      fontSize: `${fontSize}px`,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '95%',
                    }}
                  >
                    {sectorName}
                  </div>
                  <div
                    style={{
                      marginTop: '6px',
                      fontSize: `${detailSize}px`,
                      fontWeight: 700,
                      opacity: 0.95,
                    }}
                  >
                    {formatSignedPercent(node.data?.price_change)} | RVOL {toNumber(node.data?.relative_volume).toFixed(2)}
                  </div>
                </div>
              </foreignObject>
            )}
          </g>
        );
      })}

      <foreignObject x="12" y={height - 32} width="380" height="20">
        <div className="text-[11px] text-[var(--text-muted)]">Tile size: market cap. Color: relative volume + price change. Click sector to expand.</div>
      </foreignObject>
    </svg>
  );
}
