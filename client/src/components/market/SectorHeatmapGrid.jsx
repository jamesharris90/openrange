import { useEffect, useState } from 'react';
import { apiJSON } from '../../config/api';
import TickerLink from '../shared/TickerLink';

function tileClass(value) {
  const num = Number(value || 0);
  if (num >= 0) return 'border-emerald-500/40 bg-emerald-600/10';
  return 'border-rose-500/40 bg-rose-600/10';
}

function fmt(num) {
  const value = Number(num);
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export default function SectorHeatmapGrid() {
  const [tiles, setTiles] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/market/sectors');
        const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
        const next = sectors.flatMap((sector) => {
          const leaders = Array.isArray(sector?.leaders) ? sector.leaders : [];
          const sectorVolume = Number(sector?.total_volume || 0);
          return leaders.map((leader) => ({
            sector: sector?.sector || 'Unknown',
            symbol: String(leader?.symbol || '').toUpperCase(),
            change_percent: Number(leader?.change_percent || 0),
            market_cap_weight: sectorVolume,
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

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      {tiles.map((tile) => (
        <div key={`${tile.sector}-${tile.symbol}`} className={`rounded-md border p-2 ${tileClass(tile.change_percent)}`}>
          <div className="flex items-center justify-between">
            <TickerLink symbol={tile.symbol} />
            <span className={Number(tile.change_percent) >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{fmt(tile.change_percent)}</span>
          </div>
          <div className="text-xs text-[var(--text-secondary)]">{tile.sector}</div>
          <div className="text-xs text-[var(--text-muted)]">Weight {Number(tile.market_cap_weight || 0).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
