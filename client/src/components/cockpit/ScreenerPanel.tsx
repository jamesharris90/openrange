import React, { useCallback } from 'react';
import type { ScreenerRow } from '../../hooks/useCockpitData';

type ScreenerPanelProps = {
  rows: ScreenerRow[];
  onSelectTicker: (ticker: string) => void;
};

function fmt(value: number | null, digits = 2): string {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
}

export default function ScreenerPanel({ rows, onSelectTicker }: ScreenerPanelProps) {
  const handleSelect = useCallback((ticker: string) => {
    onSelectTicker(ticker);
  }, [onSelectTicker]);

  return (
    <div className="h-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Screener (Top 10)</div>
      <div className="space-y-1 overflow-auto" style={{ maxHeight: '100%' }}>
        {rows.slice(0, 10)?.map((row) => (
          <button
            type="button"
            key={row.symbol}
            className="grid w-full grid-cols-4 items-center rounded bg-[var(--bg-input)] px-2 py-1 text-left text-xs"
            onClick={() => handleSelect(row.symbol)}
          >
            <span className="font-semibold">{row.symbol}</span>
            <span>{fmt(row.price, 2)}</span>
            <span className={Number(row.changePercent) >= 0 ? 'text-emerald-500' : 'text-red-500'}>{fmt(row.changePercent, 2)}%</span>
            <span>RVOL {fmt(row.rvol, 2)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
