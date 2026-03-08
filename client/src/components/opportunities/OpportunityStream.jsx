import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJSON } from '../../config/api';
import Card from '../ui/Card';
import SkeletonCard from '../ui/SkeletonCard';
import TickerLink from '../shared/TickerLink';
import { useSymbol } from '../../context/SymbolContext';

const REFRESH_MS = 60000;

function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(digits);
}

export default function OpportunityStream({ limit = 25, compact = false }) {
  const navigate = useNavigate();
  const { setSelectedSymbol } = useSymbol();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON(`/api/opportunities/top?limit=${encodeURIComponent(limit)}`);
        if (cancelled) return;
        setItems(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [limit]);

  if (loading && !items.length) {
    return <SkeletonCard lines={compact ? 5 : 7} />;
  }

  if (!items.length) {
    return <div className="muted text-sm">No active opportunities right now.</div>;
  }

  return (
    <div className="space-y-2">
      {items.slice(0, limit).map((row) => {
        const symbol = String(row?.symbol || '').toUpperCase();
        return (
          <Card
            key={`${symbol}-${row?.updated_at || row?.score || Math.random()}`}
            className="cursor-pointer p-3 transition hover:bg-[var(--bg-card-hover)]"
            onClick={() => {
              if (!symbol) return;
              setSelectedSymbol(symbol);
              navigate(`/charts?symbol=${encodeURIComponent(symbol)}`);
            }}
          >
            <div className="mb-1 flex items-center justify-between">
              <TickerLink symbol={symbol} />
              <strong className="text-sm">{fmt(row?.score, 1)}</strong>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-[var(--text-muted)]">
              <span>Gap {fmt(row?.gap, 2)}%</span>
              <span>RVOL {fmt(row?.rvol, 2)}</span>
              <span>Vol {Number(row?.volume || 0).toLocaleString()}</span>
            </div>
            {!compact && (
              <>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">{row?.strategy || 'Strategy N/A'}</div>
                <div className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{row?.catalyst || 'No catalyst summary'}</div>
                {(row?.signal_explanation || row?.rationale) && (
                  <div className="mt-1 line-clamp-3 text-xs text-[var(--text-secondary)]">
                    {row?.signal_explanation || row?.rationale}
                  </div>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
