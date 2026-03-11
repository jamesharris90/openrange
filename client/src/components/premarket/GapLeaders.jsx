import { useState } from 'react';
import TickerLogo from '../TickerLogo';
import Sparkline from '../charts/Sparkline';

function pct(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function floatBand(floatValue) {
  const f = Number(floatValue || 0);
  if (f < 20_000_000) return 'Explosive';
  if (f < 80_000_000) return 'Volatile';
  return 'Stable';
}

export default function GapLeaders({ rows = [], onSelectTicker }) {
  const [expanded, setExpanded] = useState(false);
  const leaders = [...rows]
    .sort((a, b) => Number(b?.gap_percent || 0) - Number(a?.gap_percent || 0))
    .slice(0, expanded ? 8 : 4);

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">Gap Leaders</h3>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="rounded border border-[var(--border-color)] px-2 py-1 text-xs">
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {leaders?.map((row) => {
          const symbol = String(row?.symbol || '').toUpperCase();
          const rvol = Number(row?.relative_volume || 0);
          const floatNum = Number(row?.float || 0);
          const up = Number(row?.gap_percent || 0) >= 0;
          return (
            <button key={symbol} type="button" onClick={() => onSelectTicker?.(symbol)} className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-left">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TickerLogo symbol={symbol} className="h-5 w-5" />
                  <span className="font-semibold">{symbol}</span>
                </div>
                <span className={up ? 'text-emerald-400' : 'text-rose-400'}>{up ? '▲' : '▼'} {pct(row?.gap_percent)}</span>
              </div>
              <div className="mt-2">
                <Sparkline symbol={symbol} positive={up} width={140} height={26} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded border border-[var(--border-color)] px-2 py-1">Float: {(floatNum / 1_000_000).toFixed(0)}M</span>
                <span className="rounded border border-[var(--border-color)] px-2 py-1" title="Float = tradable shares. <20M explosive, 20-80M volatile, 80M+ stable">{floatBand(floatNum)}</span>
                <span className="rounded border border-[var(--border-color)] px-2 py-1">Sector: {row?.sector || 'Unknown'}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
