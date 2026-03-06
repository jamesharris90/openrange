import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';
import TickerLink from '../shared/TickerLink';
import SparklineMini from '../charts/SparklineMini';

const TARGETS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL'];

function findRow(rows, symbol) {
  if (symbol === '10Y') return rows.find((row) => ['10Y', 'TNX', '^TNX'].includes(String(row?.symbol || '').toUpperCase()));
  if (symbol === 'VIX') return rows.find((row) => ['VIX', '^VIX'].includes(String(row?.symbol || '').toUpperCase()));
  return rows.find((row) => String(row?.symbol || '').toUpperCase() === symbol);
}

function fmt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

export default function MarketTickerBar() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const payloads = await Promise.all(
          TARGETS.map(async (symbol) => {
            try {
              const quote = await apiJSON(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
              return {
                symbol,
                price: quote?.price ?? quote?.last ?? null,
                change_percent: quote?.change_percent ?? quote?.changePercent ?? null,
                sparkline: Array.isArray(quote?.sparkline) ? quote.sparkline : null,
              };
            } catch {
              return { symbol, price: null, change_percent: null, sparkline: null };
            }
          })
        );
        if (!cancelled) setRows(payloads);
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
    const normalized = TARGETS.map((symbol) => ({
      symbol,
      row: findRow(rows, symbol) || { symbol, price: null, change_percent: null, sparkline: null },
    }));
    return [...normalized, ...normalized];
  }, [rows]);

  return (
    <div className="border-b border-[var(--border-default)] bg-[var(--bg-elevated)]">
      <div className="overflow-hidden px-3">
        <div className="flex min-w-max items-center gap-6 py-2 text-xs" style={{ animation: 'ticker-scroll 38s linear infinite' }}>
          {stream.map((item, idx) => {
            const cp = Number(item.row?.change_percent);
            const color = !Number.isFinite(cp) ? 'text-[var(--text-muted)]' : cp >= 0 ? 'text-emerald-400' : 'text-rose-400';
            return (
              <div key={`${item.symbol}-${idx}`} className="flex items-center gap-2 whitespace-nowrap">
                <TickerLink symbol={item.symbol} className="text-xs" />
                <span className="text-[var(--text-secondary)]">{Number.isFinite(Number(item.row?.price)) ? Number(item.row?.price).toFixed(2) : '--'}</span>
                <span className={color}>{fmt(item.row?.change_percent)}</span>
                <SparklineMini
                  points={item.row?.sparkline}
                  symbol={item.symbol}
                  positive={cp >= 0}
                  width={64}
                  height={18}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
