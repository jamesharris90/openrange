import { useMemo, useState } from 'react';

function fmt(value, digits = 2, suffix = '') {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `${num.toFixed(digits)}${suffix}`;
}

export default function RadarTickerTape({ rows = [], onSelectSector }) {
  const [hovered, setHovered] = useState(null);

  const stream = useMemo(() => {
    const base = Array.isArray(rows) ? rows.slice(0, 24) : [];
    return [...base, ...base];
  }, [rows]);

  return (
    <div className="relative overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)]">
      {!stream.length ? <div className="px-3 py-2 text-sm muted">No ticker flow available.</div> : null}
      {stream.length ? (
        <div className="group">
          <div className="flex min-w-max items-center gap-5 px-3 py-2 text-sm" style={{ animation: 'openrangeTicker 30s linear infinite' }}>
            {stream?.map((row, index) => {
              const cp = Number(row?.change_percent || row?.gap || 0);
              const color = cp >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
              const symbol = String(row?.symbol || '').toUpperCase();
              const sector = row?.sector || 'Unknown';
              return (
                <button
                  key={`${symbol}-${index}`}
                  type="button"
                  onMouseEnter={() => setHovered(`${symbol}-${index}`)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onSelectSector?.(sector)}
                  className="relative flex items-center gap-2 whitespace-nowrap rounded px-1 py-0.5 text-left"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <strong>{symbol || '--'}</strong>
                  <span style={{ color }}>{cp >= 0 ? '+' : ''}{fmt(cp, 2, '%')}</span>
                  {hovered === `${symbol}-${index}` ? (
                    <span className="absolute left-0 top-full z-30 mt-1 w-56 rounded border border-[var(--border-default)] bg-[var(--bg-card)] p-2 text-xs shadow-lg">
                      <div><strong>{symbol}</strong></div>
                      <div>Sector: {sector}</div>
                      <div>Market cap: {fmt((Number(row?.market_cap || 0) / 1_000_000_000), 1, 'B')}</div>
                      <div>Relative volume: {fmt(row?.relative_volume, 2)}x</div>
                      <div>Gap: {fmt(row?.gap_percent ?? row?.gap, 2, '%')}</div>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <style>{`.group:hover div[style*="openrangeTicker"]{animation-play-state:paused}@keyframes openrangeTicker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}`}</style>
        </div>
      ) : null}
    </div>
  );
}
