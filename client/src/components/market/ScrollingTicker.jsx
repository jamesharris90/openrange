import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';
import TickerLink from '../shared/TickerLink';

function colorClass(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'text-[var(--text-secondary)]';
  return num >= 0 ? 'text-emerald-400' : 'text-rose-400';
}

export default function ScrollingTicker() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/market/context');
        const context = payload && typeof payload === 'object' ? payload : {};
        const tickers = Object.values(context)?.map((row) => ({
          symbol: row?.symbol,
          change_percent: row?.change_percent,
        }));
        if (!cancelled) setRows(tickers);
      } catch {
        if (!cancelled) setRows([]);
      }
    }

    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const stream = useMemo(() => {
    if (!rows.length) return [];
    return [...rows, ...rows];
  }, [rows]);

  return (
    <div className="relative overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-sidebar)]">
      <style>{`@keyframes openrangeTicker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}`}</style>
      {!rows.length ? (
        <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">No ticker data available.</div>
      ) : (
        <div className="group">
          <div
            className="flex min-w-max items-center gap-6 px-3 py-2 text-sm"
            style={{ animation: 'openrangeTicker 30s linear infinite' }}
          >
            {stream?.map((item, idx) => {
              const change = Number(item?.change_percent || 0);
              return (
                <div key={`${item?.symbol || 'x'}-${idx}`} className="flex items-center gap-2 whitespace-nowrap">
                  <TickerLink symbol={item?.symbol} />
                  <span className={colorClass(change)}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span>
                </div>
              );
            })}
          </div>
          <style>{`.group:hover div[style*="openrangeTicker"]{animation-play-state:paused}`}</style>
        </div>
      )}
    </div>
  );
}
