import { useEffect, useState } from 'react';
import { apiJSON } from '../../config/api';

function EarningsGroup({ title, rows, onSelectTicker }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-[var(--text-muted)]">{title}</div>
      <div className="space-y-2">
        {rows.length === 0 ? <div className="text-xs text-[var(--text-muted)]">No market data available yet.</div> : null}
        {rows.slice(0, 4).map((row, idx) => {
          const symbol = String(row?.symbol || '').toUpperCase();
          return (
            <button key={`${title}-${symbol}-${idx}`} type="button" onClick={() => onSelectTicker?.(symbol)} className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-left text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{symbol || '--'}</span>
                <span className="text-[var(--text-muted)]">{row?.earnings_date ? new Date(row.earnings_date).toLocaleString() : '--'}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function EarningsPanel({ onSelectTicker }) {
  const [groups, setGroups] = useState({ today: [], tomorrow: [], after_hours: [] });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const payload = await apiJSON('/api/intelligence/earnings-window');
        if (cancelled) return;
        setGroups({
          today: Array.isArray(payload?.today) ? payload.today : [],
          tomorrow: Array.isArray(payload?.tomorrow) ? payload.tomorrow : [],
          after_hours: Array.isArray(payload?.after_hours) ? payload.after_hours : [],
        });
      } catch {
        if (!cancelled) setGroups({ today: [], tomorrow: [], after_hours: [] });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <h3 className="m-0 mb-3 text-sm font-semibold">Earnings</h3>
      <div className="space-y-3">
        <EarningsGroup title="Today" rows={groups.today} onSelectTicker={onSelectTicker} />
        <EarningsGroup title="Tomorrow" rows={groups.tomorrow} onSelectTicker={onSelectTicker} />
        <EarningsGroup title="After Hours" rows={groups.after_hours} onSelectTicker={onSelectTicker} />
      </div>
    </div>
  );
}
