import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJSON } from '../../config/api';
import TickerLink from '../shared/TickerLink';
import SparklineMini from '../charts/SparklineMini';
import { useSymbol } from '../../context/SymbolContext';

function tileColor(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || Math.abs(num) < 0.05) return 'rgba(100,116,139,0.26)';
  if (num > 0) {
    const alpha = Math.min(0.7, 0.12 + Math.abs(num) / 18);
    return `rgba(16,185,129,${alpha})`;
  }
  const alpha = Math.min(0.75, 0.12 + Math.abs(num) / 18);
  return `rgba(239,68,68,${alpha})`;
}

function fmt(num) {
  const value = Number(num);
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export default function SectorHeatmapGrid() {
  const navigate = useNavigate();
  const { setSelectedSymbol } = useSymbol();
  const [tiles, setTiles] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/market/sector-strength');
        const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
        const next = sectors.flatMap((sector) => {
          const leaders = Array.isArray(sector?.tickers) ? sector.tickers : [];
          const sectorVolume = Number(sector?.market_cap || 0);
          return leaders.map((leader) => ({
            sector: sector?.sector || 'Unknown',
            symbol: String(leader?.symbol || '').toUpperCase(),
            change_percent: Number(leader?.price_change || 0),
            market_cap_weight: sectorVolume,
            sparkline: Array.isArray(leader?.sparkline) ? leader.sparkline : null,
          }));
        });
        if (!cancelled) setTiles(next.slice(0, 48));
      } catch {
        if (!cancelled) setTiles([]);
      }
    }

    load();
    const timer = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!tiles.length) return <div className="muted">No sector tiles available.</div>;

  const maxWeight = useMemo(() => Math.max(...tiles.map((tile) => Number(tile.market_cap_weight || 0)), 1), [tiles]);

  function goToSector(sector, symbol) {
    if (symbol) setSelectedSymbol(String(symbol).toUpperCase());
    navigate(`/screener-full?sector=${encodeURIComponent(sector || '')}`);
  }

  return (
    <div className="grid auto-rows-[88px] grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
      {tiles.map((tile) => (
        <button
          key={`${tile.sector}-${tile.symbol}`}
          type="button"
          onClick={() => goToSector(tile.sector, tile.symbol)}
          className="rounded-xl border border-[var(--border-default)] p-4 text-left shadow-[0_8px_20px_rgba(8,12,20,0.14)]"
          style={{
            background: tileColor(tile.change_percent),
            gridColumn: `span ${Math.max(1, Math.min(2, Math.round((Number(tile.market_cap_weight || 0) / maxWeight) * 2)))}`,
            gridRow: `span ${Math.max(1, Math.min(2, Math.round((Number(tile.market_cap_weight || 0) / maxWeight) * 2)))}`,
          }}
        >
          <div className="flex items-center justify-between">
            <TickerLink symbol={tile.symbol} />
            <span className={Number(tile.change_percent) >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{fmt(tile.change_percent)}</span>
          </div>
          <div className="text-xs text-[var(--text-secondary)]">{tile.sector}</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="text-xs text-[var(--text-muted)]">MCap {Number(tile.market_cap_weight || 0).toLocaleString()}</div>
            <SparklineMini points={tile.sparkline} symbol={tile.symbol} positive={Number(tile.change_percent) >= 0} width={70} height={20} />
          </div>
        </button>
      ))}
    </div>
  );
}
