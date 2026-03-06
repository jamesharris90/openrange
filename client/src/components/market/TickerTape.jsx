import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';
import { useSymbol } from '../../context/SymbolContext';
import TickerHoverPanel from './TickerHoverPanel';

function fmtPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
}

function fmtPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('en-US');
}

export default function TickerTape() {
  const { selectedSymbol, setSelectedSymbol } = useSymbol();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [hoveredSymbol, setHoveredSymbol] = useState('');
  const [detailBySymbol, setDetailBySymbol] = useState({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/market/ticker-tape');
        const tickers = Array.isArray(payload) ? payload : [];
        if (cancelled) return;
        setRows(tickers);
        setError(tickers.length ? '' : 'Data temporarily unavailable');
      } catch (_error) {
        if (cancelled) return;
        setRows([]);
        setError('Data temporarily unavailable');
      }
    }

    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDetails(symbol) {
      if (!symbol || detailBySymbol[symbol]) return;
      try {
        const payload = await apiJSON(`/api/market/quote?symbol=${encodeURIComponent(symbol)}`);
        if (!cancelled) {
          setDetailBySymbol((prev) => ({
            ...prev,
            [symbol]: payload,
          }));
        }
      } catch (_error) {
        if (!cancelled) {
          setDetailBySymbol((prev) => ({
            ...prev,
            [symbol]: null,
          }));
        }
      }
    }

    loadDetails(hoveredSymbol);
    return () => {
      cancelled = true;
    };
  }, [detailBySymbol, hoveredSymbol]);

  const stream = useMemo(() => {
    if (!rows.length) return [];
    return [...rows, ...rows];
  }, [rows]);

  const hoveredDetail = hoveredSymbol ? detailBySymbol[hoveredSymbol] : null;

  if (error) {
    return (
      <div className="border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-muted)]">
        Data temporarily unavailable
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="border-b border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-muted)]">
        Loading ticker tape...
      </div>
    );
  }

  return (
    <div className="relative border-b border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <style>{`.or-ticker-track{animation:orTickerTape 38s linear infinite}.or-ticker-wrap:hover .or-ticker-track{animation-play-state:paused}@keyframes orTickerTape{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}`}</style>
      <div className="or-ticker-wrap overflow-hidden px-3">
        <div className="or-ticker-track flex min-w-max items-center gap-4 py-2 text-xs">
          {stream.map((row, index) => {
            const symbol = String(row?.symbol || '').toUpperCase();
            const active = symbol && symbol === selectedSymbol;
            const change = Number(row?.changePercent ?? row?.change_percent);
            const color = Number.isFinite(change)
              ? (change >= 0 ? 'text-emerald-400' : 'text-rose-400')
              : 'text-[var(--text-muted)]';

            return (
              <button
                type="button"
                key={`${symbol}-${index}`}
                className={`inline-flex items-center gap-2 rounded px-2 py-1 whitespace-nowrap transition ${active ? 'bg-[rgba(74,158,255,0.16)]' : 'hover:bg-[var(--bg-hover)]'}`}
                onMouseEnter={() => setHoveredSymbol(symbol)}
                onMouseLeave={() => setHoveredSymbol('')}
                onClick={() => symbol && setSelectedSymbol(symbol)}
              >
                <span className="font-semibold text-[var(--text-primary)]">{symbol || '--'}</span>
                <span className="text-[var(--text-secondary)]">{fmtPrice(row?.price)}</span>
                <span className={color}>{fmtPercent(row?.changePercent ?? row?.change_percent)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {hoveredSymbol && <TickerHoverPanel symbol={hoveredSymbol} detail={hoveredDetail} />}
    </div>
  );
}
