import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';

const REFRESH_MS = 60000;

function fmtPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
}

function fmtChange(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function TapeSection({ label, rows = [] }) {
  return (
    <div className="flex items-center gap-3">
      <span className="rounded bg-[rgba(74,158,255,0.18)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-blue)]">{label}</span>
      {rows.map((row) => {
        const symbol = String(row?.symbol || '').toUpperCase();
        const change = Number(row?.change_percent);
        return (
          <span key={`${label}-${symbol}`} className="inline-flex items-center gap-1 text-xs">
            <strong>{symbol}</strong>
            <span>{fmtPrice(row?.price)}</span>
            <span className={change >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}>{fmtChange(row?.change_percent)}</span>
          </span>
        );
      })}
    </div>
  );
}

export default function MarketTickerTape() {
  const [sections, setSections] = useState({ indices: [], top_gainers: [], top_losers: [], crypto: [] });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/cache/ticker');
        if (cancelled) return;
        setSections(payload?.sections || payload?.rows || { indices: [], top_gainers: [], top_losers: [], crypto: [] });
      } catch {
        if (!cancelled) setSections({ indices: [], top_gainers: [], top_losers: [], crypto: [] });
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const anyData = useMemo(
    () => Object.values(sections).some((list) => Array.isArray(list) && list.length > 0),
    [sections]
  );

  return (
    <div className="relative overflow-hidden border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/95">
      {!anyData ? (
        <div className="px-3 py-2 text-xs text-[var(--text-muted)]">Loading market tape...</div>
      ) : (
        <div className="ticker-tape-track flex min-w-max items-center gap-8 py-2 text-xs" style={{ animation: 'ticker-scroll 55s linear infinite' }}>
          <TapeSection label="Indices" rows={sections.indices} />
          <TapeSection label="Top Gainers" rows={sections.top_gainers} />
          <TapeSection label="Top Losers" rows={sections.top_losers} />
          <TapeSection label="Crypto" rows={sections.crypto} />
          <TapeSection label="Indices" rows={sections.indices} />
          <TapeSection label="Top Gainers" rows={sections.top_gainers} />
          <TapeSection label="Top Losers" rows={sections.top_losers} />
          <TapeSection label="Crypto" rows={sections.crypto} />
        </div>
      )}
    </div>
  );
}
