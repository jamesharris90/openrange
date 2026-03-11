import React, { useEffect, useMemo, useState } from 'react';
import { useSymbol } from '../../context/SymbolContext';
import type { CockpitWatchlistRow } from '../../hooks/useCockpitWatchlists';

type DynamicWatchlistProps = {
  rows: CockpitWatchlistRow[];
  onPlan: (symbol: string) => void;
  staticAtCap: boolean;
  onVisibleSymbolsChange?: (symbols: string[]) => void;
};

const PAGE_SIZE = 8;

function formatPrice(value: number | null): string {
  return Number.isFinite(value) ? Number(value).toFixed(2) : '--';
}

function formatPercent(value: number | null): string {
  return Number.isFinite(value) ? `${Number(value).toFixed(2)}%` : '--';
}

function formatVolume(value: number | null): string {
  if (!Number.isFinite(value)) return '--';
  const numeric = Number(value);
  if (numeric >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(1)}B`;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(1)}K`;
  return String(Math.round(numeric));
}

export default function DynamicWatchlist({ rows, onPlan, staticAtCap, onVisibleSymbolsChange }: DynamicWatchlistProps) {
  const { symbol, setSymbol } = useSymbol();
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  useEffect(() => {
    onVisibleSymbolsChange?.(pagedRows?.map((row) => row.symbol));
  }, [onVisibleSymbolsChange, pagedRows]);

  return (
    <div className="text-xs">
      <div className="mb-2 grid grid-cols-5 uppercase tracking-wider text-gray-400">
        <div>Symbol</div>
        <div>Price</div>
        <div>%</div>
        <div>Vol</div>
        <div className="text-right">Action</div>
      </div>

      <div className="space-y-1">
        {pagedRows?.map((row) => (
          <div
            key={row.symbol}
            onClick={() => setSymbol(row.symbol)}
            className={`grid cursor-pointer grid-cols-5 items-center rounded-sm px-1 py-1 ${
              symbol === row.symbol ? 'bg-gray-800' : 'hover:bg-gray-800/50'
            }`}
          >
            <div className="font-medium text-gray-200">{row.symbol}</div>
            <div className="text-gray-200">{formatPrice(row.price)}</div>
            <div className={Number(row.percent) >= 0 ? 'text-green-400' : 'text-red-400'}>{formatPercent(row.percent)}</div>
            <div className="text-gray-300">{formatVolume(row.volume)}</div>
            <div className="text-right">
              <button
                type="button"
                disabled={staticAtCap}
                onClick={(event) => {
                  event.stopPropagation();
                  onPlan(row.symbol);
                }}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-200"
                title={staticAtCap ? 'Static list is full (16/16)' : 'Promote to premarket plan'}
              >
                + Plan
              </button>
            </div>
          </div>
        ))}
        {!pagedRows.length && <div className="py-3 text-center text-gray-500">No live signals</div>}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          className="rounded border border-gray-700 px-2 py-0.5 disabled:opacity-40"
        >
          Prev
        </button>
        <span>{page}/{totalPages}</span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          className="rounded border border-gray-700 px-2 py-0.5 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
