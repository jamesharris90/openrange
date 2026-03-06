import React, { useEffect, useMemo, useState } from 'react';
import { useSymbol } from '../../context/SymbolContext';
import type { CockpitWatchlistRow } from '../../hooks/useCockpitWatchlists';
import TickerLink from '../shared/TickerLink';
import ButtonPrimary from '../ui/ButtonPrimary';
import ButtonGhost from '../ui/ButtonGhost';

type WatchlistProps = {
  rows: CockpitWatchlistRow[];
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  staticCount: number;
  staticMax: number;
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

export default function Watchlist({ rows, onAdd, onRemove, staticCount, staticMax, staticAtCap, onVisibleSymbolsChange }: WatchlistProps) {
  const { symbol, setSymbol } = useSymbol();
  const [draft, setDraft] = useState('');
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
    onVisibleSymbolsChange?.(pagedRows.map((row) => row.symbol));
  }, [onVisibleSymbolsChange, pagedRows]);

  const handleAdd = () => {
    if (staticAtCap) return;
    const next = String(draft || '').trim().toUpperCase();
    if (!next) return;
    onAdd(next);
    setDraft('');
  };

  return (
    <div className="text-xs">
      <div className="mb-2 flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleAdd();
          }}
          disabled={staticAtCap}
          className="h-7 flex-1 rounded border border-gray-700 bg-gray-950 px-2 text-xs text-gray-200 outline-none"
          placeholder="Add symbol"
        />
        <ButtonPrimary onClick={handleAdd} disabled={staticAtCap} className="h-7 px-2 text-[11px] uppercase tracking-wider">
          Add
        </ButtonPrimary>
      </div>

      <div className="mb-2 text-[10px] uppercase tracking-wider text-gray-400">
        {staticCount}/{staticMax} planned
      </div>

      <div className="mb-2 grid grid-cols-5 uppercase tracking-wider text-gray-400">
        <div>Symbol</div>
        <div>Price</div>
        <div>%</div>
        <div>Vol</div>
        <div className="text-right">Action</div>
      </div>

      <div className="space-y-1">
        {pagedRows.map((row) => (
          <div
            key={row.symbol}
            onClick={() => setSymbol(row.symbol)}
            className={`grid cursor-pointer grid-cols-5 items-center rounded-sm px-1 py-1 ${
              symbol === row.symbol ? 'bg-gray-800' : 'hover:bg-gray-800/50'
            }`}
          >
            <div className="font-medium text-gray-200"><TickerLink symbol={row.symbol} /></div>
            <div className="text-gray-200">{formatPrice(row.price)}</div>
            <div className={Number(row.percent) >= 0 ? 'text-green-400' : 'text-red-400'}>{formatPercent(row.percent)}</div>
            <div className="text-gray-300">{formatVolume(row.volume)}</div>
            <div className="text-right">
              <ButtonGhost
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(row.symbol);
                }}
                className="px-2 py-0.5 text-[10px] uppercase tracking-wider"
              >
                Remove
              </ButtonGhost>
            </div>
          </div>
        ))}
        {!pagedRows.length && <div className="py-3 text-center text-gray-500">No planned symbols</div>}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400">
        <ButtonGhost
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          className="px-2 py-0.5 disabled:opacity-40"
        >
          Prev
        </ButtonGhost>
        <span>{page}/{totalPages}</span>
        <ButtonGhost
          disabled={page >= totalPages}
          onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          className="px-2 py-0.5 disabled:opacity-40"
        >
          Next
        </ButtonGhost>
      </div>
    </div>
  );
}
