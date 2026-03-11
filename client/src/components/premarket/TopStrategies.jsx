import ScoreExplanationTooltip from './ScoreExplanationTooltip';
import { useEffect, useState } from 'react';
import { apiJSON } from '../../config/api';

function pct(value) {
  const n = Number(value || 0);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function TopStrategies({ rows = [], onSelectTicker, onExpandWatchlist }) {
  const [accuracyRows, setAccuracyRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function loadAccuracy() {
      try {
        const payload = await apiJSON('/api/metrics/strategy-accuracy');
        if (!cancelled) setAccuracyRows(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (!cancelled) setAccuracyRows([]);
      }
    }
    loadAccuracy();
    return () => { cancelled = true; };
  }, []);

  const top = [...rows]
    .sort((a, b) => Number(b?.strategy_score || 0) - Number(a?.strategy_score || 0))
    .slice(0, 4);

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">Top Strategy Setups</h3>
        <button type="button" onClick={onExpandWatchlist} className="rounded border border-[var(--border-color)] px-2 py-1 text-xs">Expand Watchlist</button>
      </div>
      <div className="space-y-2">
        {top?.map((row, index) => {
          const symbol = String(row?.symbol || '').toUpperCase();
          const strategy = row?.setup_type || row?.strategy || 'Momentum Continuation';
          const accuracy = accuracyRows.find((item) => String(item?.strategy || '').toLowerCase() === String(strategy).toLowerCase());
          return (
            <button key={`${symbol}-${index}`} type="button" onClick={() => onSelectTicker?.(symbol)} className="group relative w-full rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-left">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{symbol || '--'}</div>
                  <div className="text-xs text-[var(--text-muted)]">{strategy}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{Math.round(Number(row?.strategy_score || 0))}</div>
                  <div className="text-xs text-[var(--text-muted)]">Score</div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--text-muted)] sm:grid-cols-3">
                <div>RVOL {Number(row?.relative_volume || 0).toFixed(2)}x</div>
                <div>Gap {pct(row?.gap_percent)}</div>
                <div title="Based on last 120 signals.">Accuracy {accuracy ? `${Number(accuracy.accuracy_rate || 0).toFixed(0)}%` : '--'}</div>
              </div>
              <ScoreExplanationTooltip row={row} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
