import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';
import TickerLink from '../shared/TickerLink';
import { Link } from 'react-router-dom';

const BUCKETS = ['Gap & Go', 'VWAP Reclaim', 'ORB Breakout', 'Short Squeeze'];

export default function StrategyLeaderboard() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/signals');
        const signals = Array.isArray(payload?.signals) ? payload.signals : [];
        if (!cancelled) setRows(signals);
      } catch {
        if (!cancelled) setRows([]);
      }
    }

    load();
    const timer = setInterval(load, 45000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const topByStrategy = useMemo(() => {
    const map = new Map();
    BUCKETS.forEach((bucket) => {
      const match = rows
        .filter((row) => String(row?.strategy || '').toLowerCase().includes(bucket.toLowerCase()))
        .sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0))[0] || null;
      map.set(bucket, match);
    });
    return map;
  }, [rows]);

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      {BUCKETS.map((bucket) => {
        const row = topByStrategy.get(bucket);
        return (
          <div key={bucket} className="rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
            <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{bucket}</div>
            {row ? (
              <>
                <div className="mt-1"><TickerLink symbol={row.symbol} /></div>
                <div className="text-sm text-[var(--text-secondary)]">Score {Number(row?.score || 0).toFixed(1)}</div>
                <div className="text-xs text-[var(--text-muted)]">Gap {Number(row?.gap_percent || 0).toFixed(2)}% · RVol {Number(row?.relative_volume || 0).toFixed(2)}</div>
                <Link to={`/setup/${encodeURIComponent(String(row?.symbol || '').toUpperCase())}`} className="mt-1 inline-block text-xs text-[var(--accent-blue)] hover:underline">Open setup</Link>
              </>
            ) : (
              <div className="mt-1 text-sm text-[var(--text-secondary)]">No signal</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
