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
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownData, setBreakdownData] = useState(null);
  const [breakdownSymbol, setBreakdownSymbol] = useState('');

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

  async function openBreakdown(symbol) {
    if (!symbol) return;
    setBreakdownLoading(true);
    setBreakdownOpen(true);
    setBreakdownSymbol(symbol);
    setBreakdownData(null);
    try {
      const payload = await apiJSON(`/api/signals/${encodeURIComponent(symbol)}/score`);
      setBreakdownData(payload?.item || null);
    } catch {
      setBreakdownData(null);
    } finally {
      setBreakdownLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      {items.slice(0, limit)?.map((row) => {
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
                <button
                  type="button"
                  className="mt-2 rounded border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    openBreakdown(symbol);
                  }}
                >
                  Full Score Breakdown
                </button>
              </>
            )}
          </Card>
        );
      })}

      {breakdownOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setBreakdownOpen(false)}>
          <div className="max-h-[80vh] w-full max-w-xl overflow-auto rounded border border-[var(--border-color)] bg-[var(--bg-primary)] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="m-0 text-base">{breakdownSymbol} Full Score Breakdown</h3>
              <button type="button" className="rounded border border-[var(--border-color)] px-2 py-1 text-xs" onClick={() => setBreakdownOpen(false)}>Close</button>
            </div>

            {breakdownLoading ? (
              <div className="muted text-sm">Loading breakdown...</div>
            ) : !breakdownData ? (
              <div className="muted text-sm">No score breakdown available.</div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>Gap Strength: <strong>{fmt(breakdownData?.score_breakdown?.gap_score, 2)}</strong></div>
                  <div>Relative Volume: <strong>{fmt(breakdownData?.score_breakdown?.rvol_score, 2)}</strong></div>
                  <div>Float Rotation: <strong>{fmt(breakdownData?.score_breakdown?.float_rotation_score, 2)}</strong></div>
                  <div>Liquidity Surge: <strong>{fmt(breakdownData?.score_breakdown?.liquidity_surge_score, 2)}</strong></div>
                  <div>Catalyst Impact: <strong>{fmt(breakdownData?.score_breakdown?.catalyst_score, 2)}</strong></div>
                  <div>Sector Strength: <strong>{fmt(breakdownData?.score_breakdown?.sector_score, 2)}</strong></div>
                  <div>Confirmation Signals: <strong>{fmt(breakdownData?.score_breakdown?.confirmation_score, 2)}</strong></div>
                  <div>Total: <strong>{fmt(breakdownData?.score_breakdown?.total_score, 2)}</strong></div>
                </div>

                <div className="rounded border border-[var(--border-color)] p-2">
                  <div className="muted mb-1 text-xs">MCP Narrative Explanation</div>
                  <div>{breakdownData?.narrative || 'No narrative available.'}</div>
                </div>

                <div className="muted text-xs">
                  Confidence: {breakdownData?.confidence || 'N/A'} | Catalyst: {breakdownData?.catalyst || 'unknown'} | Sector: {breakdownData?.sector || 'Unknown'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
