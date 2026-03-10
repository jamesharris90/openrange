import { useEffect, useMemo, useState } from 'react';
import TickerLogo from '../TickerLogo';
import { apiJSON } from '../../config/api';
import OpportunityBreakdown from './OpportunityBreakdown';

function toNum(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function TopOpportunity({ onSelectTicker }) {
  const [item, setItem] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/intelligence/top-opportunity');
        if (!cancelled) {
          setItem(payload?.item || null);
        }
      } catch {
        if (!cancelled) setItem(null);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const confidence = useMemo(() => {
    const score = toNum(item?.confidence ?? item?.opportunity_score, 0);
    const bounded = Math.max(0, Math.min(92, score));
    return Math.round(bounded);
  }, [item]);

  const symbol = String(item?.symbol || '').toUpperCase();
  const price = toNum(item?.price, 0);
  const expectedMovePct = toNum(item?.expected_move_percent, 0);
  const expectedTarget = price > 0 ? price * (1 + expectedMovePct / 100) : 0;

  if (!item) {
    return (
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-sm">
        <h3 className="m-0 mb-2 text-sm font-semibold">Top Opportunity Today</h3>
        <div>No market data available yet.</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          onSelectTicker?.(symbol);
          setShowBreakdown((prev) => !prev);
        }}
        className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-left"
      >
        <h3 className="m-0 mb-3 text-sm font-semibold">Top Opportunity Today</h3>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TickerLogo symbol={symbol} className="h-6 w-6" />
            <div className="text-lg font-semibold">{symbol || '--'}</div>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold">Confidence {confidence}%</div>
          </div>
        </div>

        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
            <div className="text-xs text-[var(--text-muted)]">Catalyst</div>
            <div>{item?.catalyst || item?.headline || 'No catalyst headline available.'}</div>
          </div>

          <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
            <div className="text-xs text-[var(--text-muted)]">Strategy</div>
            <div>{item?.strategy || 'Momentum Continuation'}</div>
          </div>

          <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
            <div className="text-xs text-[var(--text-muted)]">Expected Move</div>
            <div>
              {price > 0 ? `$${price.toFixed(2)}` : '--'}
              {' -> '}
              {expectedTarget > 0 ? `$${expectedTarget.toFixed(2)}` : '--'}
            </div>
          </div>

          <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
            <div className="text-xs text-[var(--text-muted)]">Relative Volume</div>
            <div>{toNum(item?.rvol ?? item?.relative_volume, 0).toFixed(2)}x</div>
          </div>
        </div>

        <div className="mt-2 rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-sm">
          <div className="text-xs text-[var(--text-muted)]">Trade Plan</div>
          <div>{item?.trade_plan || 'Watch for ORB break with volume confirmation.'}</div>
          <div className="mt-1 grid gap-1 text-xs sm:grid-cols-3">
            <div>Entry: {item?.entry ? `$${Number(item.entry).toFixed(2)}` : '--'}</div>
            <div>SL: {item?.stop_loss ? `$${Number(item.stop_loss).toFixed(2)}` : '--'}</div>
            <div>TP: {item?.take_profit ? `$${Number(item.take_profit).toFixed(2)}` : '--'}</div>
          </div>
        </div>

        <div className="mt-2 text-xs text-[var(--text-muted)]">Click to view full explainability breakdown.</div>
      </button>

      <OpportunityBreakdown item={item} open={showBreakdown} onClose={() => setShowBreakdown(false)} />
    </div>
  );
}
