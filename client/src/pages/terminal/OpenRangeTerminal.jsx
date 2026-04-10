import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '../../api/apiClient';
import { ConfidenceGauge } from '../../components/terminal/SignalVisuals';

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function mapCandles(candles = []) {
  return candles
    .map((row) => {
      const ts = Number(row?.time ?? row?.timestamp ?? 0);
      const close = toNum(row?.close, null);
      if (!ts || close == null) return null;
      return {
        ts,
        label: new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        close,
      };
    })
    .filter(Boolean);
}

function MiniChart({ data, color }) {
  return (
    <div className="h-28 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="2 2" />
          <XAxis dataKey="label" hide />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
          <Area type="monotone" dataKey="close" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={1.8} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function OpenRangeTerminal() {
  const [loading, setLoading] = useState(true);
  const [watchlistRows, setWatchlistRows] = useState([]);
  const [priorityRows, setPriorityRows] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState('SPY');
  const [charts, setCharts] = useState({ oneM: [], fiveM: [], daily: [] });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [watchlistPayload, opportunitiesPayload, priorityPayload] = await Promise.all([
          apiClient('/watchlist/signals').catch(() => []),
          apiClient('/opportunities?limit=24').catch(() => []),
          apiClient('/intelligence/priority').catch(() => ({ results: [] })),
        ]);

        const merged = new Map();
        [...toRows(watchlistPayload), ...toRows(opportunitiesPayload)].forEach((row) => {
          const symbol = String(row?.symbol || row?.ticker || '').toUpperCase();
          if (!symbol) return;
          const existing = merged.get(symbol);
          const score = toNum(row?.confidence ?? row?.score ?? row?.priority_score, 0);
          const existingScore = toNum(existing?.confidence ?? existing?.score ?? existing?.priority_score, -1);
          if (!existing || score > existingScore) merged.set(symbol, { ...row, symbol });
        });

        const sortedWatch = [...merged.values()]
          .sort((a, b) => toNum(b?.confidence ?? b?.score ?? b?.priority_score, 0) - toNum(a?.confidence ?? a?.score ?? a?.priority_score, 0))
          .slice(0, 20);

        const priority = toRows(priorityPayload).slice(0, 12);

        if (!cancelled) {
          setWatchlistRows(sortedWatch);
          setPriorityRows(priority);
          setSelectedSymbol(sortedWatch[0]?.symbol || priority[0]?.symbol || 'SPY');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCharts() {
      if (!selectedSymbol) return;
      const [oneM, fiveM, daily] = await Promise.all([
        apiClient(`/v5/chart?symbol=${encodeURIComponent(selectedSymbol)}&timeframe=1D&interval=1m`).catch(() => ({})),
        apiClient(`/v5/chart?symbol=${encodeURIComponent(selectedSymbol)}&timeframe=1D&interval=5m`).catch(() => ({})),
        apiClient(`/v5/chart?symbol=${encodeURIComponent(selectedSymbol)}&timeframe=6M&interval=1day`).catch(() => ({})),
      ]);

      if (!cancelled) {
        setCharts({
          oneM: mapCandles(oneM?.candles || []),
          fiveM: mapCandles(fiveM?.candles || []),
          daily: mapCandles(daily?.candles || []),
        });
      }
    }

    loadCharts();
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  const selectedNarrative = useMemo(() => {
    const symbol = String(selectedSymbol || '').toUpperCase();
    return priorityRows.find((row) => String(row?.symbol || '').toUpperCase() === symbol) || priorityRows[0] || null;
  }, [priorityRows, selectedSymbol]);

  return (
    <div className="space-y-4 bg-slate-950 text-slate-100">
      <section className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h1 className="text-xl font-semibold">OpenRange Trading Terminal</h1>
        <p className="mt-1 text-sm text-slate-400">Watchlist flow, multi-timeframe charts, and AI execution narratives in one workspace.</p>
      </section>

      <section className="grid grid-cols-12 gap-4">
        <aside className="col-span-12 xl:col-span-3 rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-300">Watchlist</h2>
            <span className="text-xs text-slate-500">{watchlistRows.length} symbols</span>
          </div>

          <div className="space-y-2">
            {watchlistRows.map((row, idx) => {
              const symbol = String(row?.symbol || row?.ticker || '').toUpperCase();
              const change = toNum(row?.change_percent ?? row?.move_percent, 0);
              const active = symbol === selectedSymbol;
              return (
                <button
                  key={`${symbol || 'watch'}-${idx}`}
                  type="button"
                  onClick={() => setSelectedSymbol(symbol)}
                  className={`grid w-full grid-cols-12 items-center gap-1 rounded border p-2 text-left ${active ? 'border-cyan-500/40 bg-slate-800' : 'border-slate-700 bg-slate-950 hover:border-slate-500'}`}
                >
                  <div className="col-span-4 font-semibold">{symbol || '--'}</div>
                  <div className="col-span-4 text-[11px] text-slate-400">{toNum(row?.price, null)?.toFixed?.(2) || '--'}</div>
                  <div className={`col-span-4 text-right text-[11px] ${change >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                  </div>
                </button>
              );
            })}
            {!loading && watchlistRows.length === 0 ? <div className="text-xs text-slate-500">No qualifying setups right now</div> : null}
          </div>
        </aside>

        <main className="col-span-12 xl:col-span-6 rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-300">{selectedSymbol} Multi Charts</h2>
            <span className="text-xs text-slate-500">1M | 5M | Daily</span>
          </div>

          <div className="grid gap-3">
            <div className="rounded border border-slate-700 bg-slate-950 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">1M</div>
              <MiniChart data={charts.oneM} color="#34d399" />
            </div>
            <div className="rounded border border-slate-700 bg-slate-950 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">5M</div>
              <MiniChart data={charts.fiveM} color="#22d3ee" />
            </div>
            <div className="rounded border border-slate-700 bg-slate-950 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Daily</div>
              <MiniChart data={charts.daily} color="#f59e0b" />
            </div>
          </div>
        </main>

        <aside className="col-span-12 xl:col-span-3 rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-300">AI Narrative</h2>
            <span className="text-xs text-slate-500">Decision Engine</span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="rounded border border-slate-700 bg-slate-950 p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Why Moving</div>
              <div className="mt-1 text-slate-300">{selectedNarrative?.why_moving || selectedNarrative?.catalyst || 'No qualifying setups right now'}</div>
            </div>

            <div className="rounded border border-slate-700 bg-slate-950 p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Why Tradeable</div>
              <div className="mt-1 text-slate-300">{selectedNarrative?.why_tradeable || 'No qualifying setups right now'}</div>
            </div>

            <div className="rounded border border-slate-700 bg-slate-950 p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Execution Plan</div>
              <div className="mt-1 grid grid-cols-3 gap-1">
                <div className="rounded border border-slate-700 bg-slate-900 p-1.5">
                  <div className="text-[10px] text-slate-500">Entry</div>
                  <div className="font-semibold text-slate-100">{selectedNarrative?.execution_plan?.entry || selectedNarrative?.entry || '--'}</div>
                </div>
                <div className="rounded border border-slate-700 bg-slate-900 p-1.5">
                  <div className="text-[10px] text-slate-500">Stop</div>
                  <div className="font-semibold text-rose-300">{selectedNarrative?.execution_plan?.stop || selectedNarrative?.stop || '--'}</div>
                </div>
                <div className="rounded border border-slate-700 bg-slate-900 p-1.5">
                  <div className="text-[10px] text-slate-500">Target</div>
                  <div className="font-semibold text-emerald-300">{selectedNarrative?.execution_plan?.target || selectedNarrative?.target || '--'}</div>
                </div>
              </div>
            </div>

            <div className="rounded border border-slate-700 bg-slate-950 p-2">
              <ConfidenceGauge value={toNum(selectedNarrative?.adjusted_confidence ?? selectedNarrative?.confidence, 0)} />
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
