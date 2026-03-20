import { memo, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '../../lib/apiClient';
import { adaptQuotesResponse } from '../../adapters/marketAdapter';

const SYMBOLS = ['SPY', 'QQQ', 'IWM', 'VIX'];
const POLL_MS = 7000;
const SPARK_POINTS = 40;

function Sparkline({ values }) {
  if (!Array.isArray(values) || values.length < 2) {
    return <div className="h-5 w-20 rounded bg-slate-800" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = 100 / (values.length - 1);
  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = 20 - ((value - min) / range) * 20;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 100 20" className="h-5 w-20" preserveAspectRatio="none" aria-label="price-sparkline">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.8" points={points} className="text-slate-300" />
    </svg>
  );
}

const TickerRow = memo(function TickerRow({ row, points }) {
  const change = row?.change;
  const isPositive = Number.isFinite(change) && change >= 0;
  const vixAlert = row?.symbol === 'VIX' && Number.isFinite(row?.price) && row.price > 25;

  return (
    <div
      className={`flex min-w-[220px] items-center justify-between gap-2 rounded-lg border px-3 py-2 ${vixAlert ? 'border-amber-400 bg-amber-500/10' : 'border-slate-800 bg-slate-900/40'}`}
    >
      <div className="font-mono text-xs text-slate-100">{row?.symbol || 'N/A'}</div>
      <div className="text-xs text-slate-200">{Number.isFinite(row?.price) ? row.price.toFixed(2) : 'N/A'}</div>
      <div className={`text-xs ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
        {Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : 'N/A'}
      </div>
      <Sparkline values={points} />
    </div>
  );
});

function MarketTickerStrip() {
  const historyRef = useRef(new Map());

  const { data = [] } = useQuery({
    queryKey: ['marketTickerStrip', SYMBOLS.join(',')],
    queryFn: async () => {
      const payload = await apiFetch(`/api/market/quotes?symbols=${encodeURIComponent(SYMBOLS.join(','))}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      return adaptQuotesResponse(payload);
    },
    refetchInterval: POLL_MS,
    staleTime: POLL_MS,
    gcTime: POLL_MS * 8,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const rows = useMemo(() => {
    return SYMBOLS.map((symbol) => data.find((item) => item.symbol === symbol)).filter(Boolean);
  }, [data]);

  const rowsWithSpark = useMemo(() => {
    return rows.map((row) => {
      const key = row.symbol;
      const existing = historyRef.current.get(key) || [];
      const next = Number.isFinite(row.price) ? [...existing, row.price].slice(-SPARK_POINTS) : existing;
      historyRef.current.set(key, next);
      return {
        row,
        points: next,
      };
    });
  }, [rows]);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-2">
      <div className="flex gap-2 overflow-x-auto">
        {rowsWithSpark.map((item) => (
          <TickerRow key={item.row.symbol} row={item.row} points={item.points} />
        ))}
      </div>
    </section>
  );
}

export default memo(MarketTickerStrip);
