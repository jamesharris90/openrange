import { useEffect, useState } from 'react';
import { authFetchJSON } from '../utils/api';
import AdminLayout from '../components/layout/AdminLayout';

function countFrom(payload, key = 'items') {
  const rows = payload?.[key];
  return Array.isArray(rows) ? rows.length : 0;
}

export default function IntelligenceMonitorPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState({
    stocksInPlay: 0,
    squeezes: 0,
    flowSignals: 0,
    topOpportunities: 0,
    engineRuntimes: {},
    providers: {},
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [stocks, squeezes, flow, opportunities, diagnostics, providerHealth] = await Promise.all([
          authFetchJSON('/api/stocks/in-play?limit=200').catch(() => ({ items: [] })),
          authFetchJSON('/api/intelligence/squeezes?limit=200').catch(() => ({ items: [] })),
          authFetchJSON('/api/intelligence/flow?limit=200').catch(() => ({ items: [] })),
          authFetchJSON('/api/opportunities/top?limit=50').catch(() => ({ items: [] })),
          authFetchJSON('/api/admin/intelligence').catch(() => ({ engines: {} })),
          authFetchJSON('/api/admin/providers').catch(() => ({ providers: {} })),
        ]);

        if (cancelled) return;
        const oppItems = opportunities?.items || opportunities?.data || [];
        const engines = diagnostics || {};
        const runtimes = Object.fromEntries(
          Object.entries(engines)?.map(([k, v]) => [k, Number(v?.runtime_ms || 0)])
        );

        setData({
          stocksInPlay: countFrom(stocks),
          squeezes: countFrom(squeezes),
          flowSignals: countFrom(flow),
          topOpportunities: Array.isArray(oppItems) ? oppItems.length : 0,
          engineRuntimes: runtimes,
          providers: providerHealth?.providers || {},
        });
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load intelligence monitor');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <AdminLayout section="Intelligence Monitor">
      <div className="space-y-4">

      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Intelligence Monitor</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Pipeline telemetry for detections, providers, and engine runtimes.</p>
      </div>

      {loading ? <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3">Loading monitor...</div> : null}
      {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-red-300">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3"><div className="text-xs text-[var(--text-muted)]">Stocks Detected Today</div><div className="text-xl font-semibold">{data?.stocksInPlay}</div></div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3"><div className="text-xs text-[var(--text-muted)]">Squeeze Signals</div><div className="text-xl font-semibold">{data?.squeezes}</div></div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3"><div className="text-xs text-[var(--text-muted)]">Flow Signals</div><div className="text-xl font-semibold">{data?.flowSignals}</div></div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3"><div className="text-xs text-[var(--text-muted)]">Top Opportunities</div><div className="text-xl font-semibold">{data?.topOpportunities}</div></div>
      </div>

      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
        <h3 className="mb-2 text-sm font-semibold">Engine Runtimes (ms)</h3>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(data?.engineRuntimes || {})?.map(([name, runtime]) => (
            <div key={name} className="rounded border border-[var(--border-color)] px-2 py-1 text-sm">
              <span className="text-[var(--text-muted)]">{name}</span>
              <span className="float-right font-semibold">{runtime}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
        <h3 className="mb-2 text-sm font-semibold">Provider Health</h3>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(data?.providers || {})?.map(([name, provider]) => (
            <div key={name} className="rounded border border-[var(--border-color)] px-2 py-1 text-sm">
              <div className="font-semibold uppercase">{name}</div>
              <div>Status: {provider?.status || 'unknown'}</div>
              <div>Latency: {provider?.latency ?? '--'} ms</div>
            </div>
          ))}
        </div>
      </div>
      </div>
    </AdminLayout>
  );
}
