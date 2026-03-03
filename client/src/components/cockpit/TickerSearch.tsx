import { useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../../utils/api';

type SearchRow = {
  symbol: string;
  name: string;
  exchange: string;
  marketCap?: number | null;
};

type TickerSearchProps = {
  symbol: string;
  onSelect: (symbol: string) => void;
};

function formatMarketCap(value?: number | null) {
  if (!Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(2)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${n}`;
}

export default function TickerSearch({ symbol, onSelect }: TickerSearchProps) {
  const [inputValue, setInputValue] = useState(symbol);
  const [selectedSymbol, setSelectedSymbol] = useState(symbol);
  const [results, setResults] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setInputValue(symbol);
    setSelectedSymbol(symbol);
  }, [symbol]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    const query = String(inputValue || '').trim();
    if (!query) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        const response = await authFetch(`/api/v5/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setResults([]);
          setOpen(true);
          return;
        }
        const payload = await response.json();
        const rows = Array.isArray(payload) ? payload : [];
        console.log('[SearchResults]', query, rows);
        setResults(rows);
        setOpen(true);
        setActiveIndex(rows.length ? 0 : -1);
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          setResults([]);
          setOpen(true);
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [inputValue]);

  const activeResult = useMemo(() => {
    if (activeIndex < 0 || activeIndex >= results.length) return null;
    return results[activeIndex];
  }, [activeIndex, results]);

  const commitSelection = (candidate: SearchRow | null) => {
    if (!candidate?.symbol) return;
    if (!results.some((row) => row.symbol === candidate.symbol)) return;

    const normalized = String(candidate.symbol).trim().toUpperCase();
    if (!normalized) return;

    onSelect(normalized);
    setSelectedSymbol(normalized);
    setInputValue(normalized);
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div ref={rootRef} className="relative w-72 max-w-[50vw]">
      <input
        value={inputValue}
        onChange={(event) => {
          setInputValue(event.currentTarget.value.toUpperCase());
          setOpen(true);
        }}
        onFocus={() => {
          if (results.length || loading) setOpen(true);
        }}
        onBlur={(event) => {
          const nextFocused = event.relatedTarget as Node | null;
          if (nextFocused && rootRef.current?.contains(nextFocused)) return;

          if (String(inputValue || '').trim().toUpperCase() !== String(selectedSymbol || '').trim().toUpperCase()) {
            setInputValue(selectedSymbol);
          }

          setOpen(false);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!results.length) return;
            setOpen(true);
            setActiveIndex((prev) => Math.min(results.length - 1, prev + 1));
            return;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!results.length) return;
            setActiveIndex((prev) => Math.max(0, prev - 1));
            return;
          }

          if (event.key === 'Escape') {
            setOpen(false);
            setActiveIndex(-1);
            return;
          }

          if (event.key === 'Enter') {
            event.preventDefault();
            if (!results.length) return;
            if (!activeResult?.symbol) return;
            commitSelection(activeResult);
          }
        }}
        className="h-9 w-full rounded-md border border-gray-800 bg-gray-900 px-3 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        placeholder="Search ticker"
        aria-label="Ticker search"
        role="combobox"
        aria-expanded={open}
      />

      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-gray-800 bg-gray-900 p-1 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
          {loading && (
            <div className="px-3 py-2 text-xs text-gray-500">Searching…</div>
          )}

          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-500">No US-listed stocks found</div>
          )}

          {!loading && results.map((row, index) => {
            const marketCapLabel = formatMarketCap(row.marketCap);
            const isActive = index === activeIndex;

            return (
              <button
                key={`${row.symbol}-${index}`}
                type="button"
                onClick={() => commitSelection(row)}
                className={`w-full rounded px-2 py-2 text-left ${isActive ? 'bg-gray-800' : 'hover:bg-gray-800'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-100">{row.symbol}</span>
                  <span className="text-[11px] uppercase tracking-wide text-gray-400">{row.exchange || '—'}</span>
                  {marketCapLabel && (
                    <span className="ml-auto text-[11px] text-gray-500">{marketCapLabel}</span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-gray-400">{row.name || 'Unknown company'}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}