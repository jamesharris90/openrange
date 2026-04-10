import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { authFetch } from '../utils/api';
import { PageContainer } from '../components/layout/PagePrimitives';

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapCandles(candles = []) {
  return candles
    .map((row) => {
      const ts = Number(row?.time ?? row?.timestamp ?? 0);
      const close = toNum(row?.close, null);
      if (!ts || close == null) return null;
      return {
        ts,
        time: new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        close,
      };
    })
    .filter(Boolean);
}

export default function MarketOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [spySeries, setSpySeries] = useState([]);
  const [quotes, setQuotes] = useState({});
  const [summary, setSummary] = useState({});
  const [sectors, setSectors] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [spyRes, quoteRes, summaryRes, sectorsRes] = await Promise.all([
          authFetch('/api/v5/chart?symbol=SPY&timeframe=1D&interval=5m').catch(() => null),
          authFetch('/api/market/quotes?symbols=SPY,QQQ,IWM,VIX').catch(() => null),
          authFetch('/api/radar/summary').catch(() => null),
          authFetch('/api/market/sector-strength').catch(() => null),
        ]);

        const [spyJson, quoteJson, summaryJson, sectorsJson] = await Promise.all([
          spyRes?.ok ? spyRes.json().catch(() => ({})) : {},
          quoteRes?.ok ? quoteRes.json().catch(() => ({ data: [] })) : { data: [] },
          summaryRes?.ok ? summaryRes.json().catch(() => ({})) : {},
          sectorsRes?.ok ? sectorsRes.json().catch(() => ({})) : {},
        ]);

        if (cancelled) return;

        const quoteRows = Array.isArray(quoteJson?.data) ? quoteJson.data : (Array.isArray(quoteJson) ? quoteJson : []);
        const sectorRows = Array.isArray(sectorsJson) ? sectorsJson : (Array.isArray(sectorsJson?.data) ? sectorsJson.data : []);

        setSpySeries(mapCandles(spyJson?.candles || []));
        setQuotes(Object.fromEntries(quoteRows.map((row) => [String(row?.symbol || '').toUpperCase(), row])));
        setSummary(summaryJson || {});
        setSectors(sectorRows);
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

  const breadth = summary?.breadth || summary || {};
  const vix = toNum(quotes?.VIX?.price, null);
  const advancers = toNum(breadth?.advancers, 0);
  const decliners = toNum(breadth?.decliners, 0);
  const breadthRatio = decliners > 0 ? (advancers / decliners) : advancers;

  const indexTiles = useMemo(() => {
    return ['SPY', 'QQQ', 'IWM', 'VIX'].map((symbol) => {
      const row = quotes[symbol] || {};
      return {
        symbol,
        price: toNum(row?.price, null),
        change: toNum(row?.change_percent, null),
      };
    });
  }, [quotes]);

  return (
    <PageContainer className="space-y-4 bg-slate-950 text-slate-100">
      <section className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h1 className="text-xl font-semibold">Market Command</h1>
        <p className="mt-1 text-sm text-slate-400">Large-index flow, risk regime, and sector rotation in one decision frame.</p>
      </section>

      <section className="grid grid-cols-12 gap-4">
        <div className="col-span-12 grid grid-cols-2 gap-2 xl:col-span-3 xl:grid-cols-1">
          {indexTiles.map((tile) => (
            <div key={tile.symbol} className="rounded-lg border border-slate-700 bg-slate-900 p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{tile.symbol}</div>
              <div className="text-lg font-semibold">{tile.price == null ? '--' : tile.price.toFixed(2)}</div>
              <div className={`text-xs ${tile.change == null ? 'text-slate-400' : tile.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {tile.change == null ? '--' : `${tile.change >= 0 ? '+' : ''}${tile.change.toFixed(2)}%`}
              </div>
            </div>
          ))}
        </div>

        <div className="col-span-12 xl:col-span-6 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-300">SPY Intraday</h2>
            <span className="text-xs text-slate-500">5m bars</span>
          </div>
          <div className="h-[420px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spySeries} margin={{ top: 8, right: 10, left: 2, bottom: 8 }}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="2 2" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={28} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                <Area type="monotone" dataKey="close" stroke="#22d3ee" strokeWidth={2} fill="url(#spyFill)" />
                <defs>
                  <linearGradient id="spyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {loading && <div className="mt-2 text-xs text-slate-500">Loading market tape...</div>}
        </div>

        <div className="col-span-12 xl:col-span-3 space-y-3">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-300">Market Stats</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between rounded border border-slate-700 bg-slate-950 p-2">
                <span className="text-slate-400">Breadth</span>
                <span className={breadthRatio >= 1 ? 'text-emerald-300' : 'text-rose-300'}>{breadthRatio.toFixed(2)} A/D</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-slate-700 bg-slate-950 p-2">
                  <div className="text-slate-500">Advancers</div>
                  <div className="font-semibold text-emerald-300">{advancers}</div>
                </div>
                <div className="rounded border border-slate-700 bg-slate-950 p-2">
                  <div className="text-slate-500">Decliners</div>
                  <div className="font-semibold text-rose-300">{decliners}</div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded border border-slate-700 bg-slate-950 p-2">
                <span className="text-slate-400">VIX Level</span>
                <span className={vix != null && vix < 18 ? 'text-emerald-300' : vix != null && vix < 24 ? 'text-amber-300' : 'text-rose-300'}>
                  {vix == null ? '--' : vix.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-300">Sector Strength</h3>
            <div className="space-y-2">
              {sectors.slice(0, 8).map((row, idx) => {
                const score = toNum(row?.change_percent ?? row?.score ?? row?.strength, 0);
                const width = Math.max(5, Math.min(100, Math.abs(score) * 12));
                return (
                  <div key={`${row?.sector || 'sector'}-${idx}`} className="rounded border border-slate-700 bg-slate-950 p-2">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-slate-300">{row?.sector || row?.name || '--'}</span>
                      <span className={score >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{score.toFixed(2)}%</span>
                    </div>
                    <div className="h-1.5 rounded bg-slate-800">
                      <div className={`h-1.5 rounded ${score >= 0 ? 'bg-emerald-400' : 'bg-rose-400'}`} style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
              {sectors.length === 0 ? <div className="text-xs text-slate-500">No qualifying setups right now</div> : null}
            </div>
          </div>
        </div>
      </section>
    </PageContainer>
  );
}
