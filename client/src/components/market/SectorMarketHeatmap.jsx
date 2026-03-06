import { useMemo, useState } from 'react';
import { hierarchy, treemap } from 'd3-hierarchy';
import TickerLink from '../shared/TickerLink';

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

export default function SectorMarketHeatmap({ sectors = [], width = 1000, height = 520 }) {
  const [expandedSector, setExpandedSector] = useState('');

  const sectorLayout = useMemo(() => {
    const root = hierarchy({
      children: sectors.map((sector) => ({
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
      children: tickers.map((ticker) => ({
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
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="m-0 text-sm">{expandedSector} Ticker Heatmap</h4>
          <button
            type="button"
            onClick={() => setExpandedSector('')}
            className="rounded border border-[var(--border-color)] px-2 py-1 text-xs hover:bg-[var(--bg-card-hover)]"
          >
            Back to Sectors
          </button>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="h-[420px] w-full rounded border border-[var(--border-color)] bg-[var(--bg-card)]">
          {expandedTickers.map((node) => {
            const w = Math.max(0, node.x1 - node.x0);
            const h = Math.max(0, node.y1 - node.y0);
            if (w < 10 || h < 10) return null;
            const symbol = String(node.data.name || '').toUpperCase();
            return (
              <g key={symbol}>
                <rect x={node.x0} y={node.y0} width={w} height={h} fill={colorForNode(node.data.relative_volume, node.data.price_change)} stroke="rgba(255,255,255,0.15)" />
                {w > 48 && h > 24 && (
                  <text x={node.x0 + 6} y={node.y0 + 16} fontSize="11" fill="currentColor">
                    {symbol}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[420px] w-full rounded border border-[var(--border-color)] bg-[var(--bg-card)]">
      {sectorLayout.map((node) => {
        const w = Math.max(0, node.x1 - node.x0);
        const h = Math.max(0, node.y1 - node.y0);
        if (w < 16 || h < 16) return null;
        const sectorName = String(node.data.name || 'Unknown');
        return (
          <g key={sectorName} onClick={() => setExpandedSector(sectorName)} className="cursor-pointer">
            <rect x={node.x0} y={node.y0} width={w} height={h} fill={colorForNode(node.data.relative_volume, node.data.price_change)} stroke="rgba(255,255,255,0.16)" />
            {w > 100 && h > 38 && (
              <>
                <text x={node.x0 + 8} y={node.y0 + 18} fontSize="12" fontWeight="600" fill="currentColor">{sectorName}</text>
                <text x={node.x0 + 8} y={node.y0 + 34} fontSize="11" fill="currentColor">RVOL {toNumber(node.data.relative_volume).toFixed(2)}</text>
              </>
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
