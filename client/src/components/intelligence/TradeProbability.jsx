import { useEffect, useState } from 'react';
import { apiJSON } from '../../config/api';

function toNum(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function TradeProbability() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/intelligence/trade-probability');
        if (!cancelled) {
          setRows(Array.isArray(payload?.items) ? payload.items : []);
        }
      } catch {
        if (!cancelled) setRows([]);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">Trade Probability Engine</h3>
        <span className="text-xs text-[var(--text-muted)]" title="Based on historical strategy signals.">Based on historical strategy signals.</span>
      </div>

      {!rows.length ? (
        <div className="text-sm">No market data available yet.</div>
      ) : (
        <div className="space-y-2 text-sm">
          {rows.slice(0, 6).map((row, index) => (
            <div key={`${row?.strategy || 'strategy'}-${index}`} className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
              <div className="font-semibold">{row?.strategy || 'Momentum Continuation'}</div>
              <div>Win Rate: {toNum(row?.win_rate, 0).toFixed(1)}%</div>
              <div>Avg Move: {toNum(row?.avg_move, 0).toFixed(1)}%</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
