import { useEffect, useMemo, useState } from 'react';
import { authFetchJSON } from '../../utils/api';
import AdminLayout from '../../components/layout/AdminLayout';

function StatusPill({ value }) {
  const normalized = String(value || 'unknown').toLowerCase();
  const cls = normalized === 'ok'
    ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200'
    : normalized === 'warning'
      ? 'border-amber-400/40 bg-amber-400/15 text-amber-200'
      : 'border-red-400/40 bg-red-400/15 text-red-200';

  return <span className={`rounded border px-2 py-0.5 text-xs ${cls}`}>{value || 'unknown'}</span>;
}

function Section({ title, children }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
      <h2 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
      {children}
    </div>
  );
}

export default function SystemMonitorPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError('');
      if (!cancelled) setLoading(true);
      try {
        const payload = await authFetchJSON('/api/system/monitor');
        if (!cancelled) setData(payload?.data || payload || null);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load system monitor');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const overview = useMemo(() => {
    if (!data) {
      return {
        events: 0,
        integrity: 0,
        alerts: 0,
      };
    }

    return {
      events: (data?.recent_events || []).length,
      integrity: (data?.integrity_events || []).length,
      alerts: (data?.system_alerts || []).length,
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <AdminLayout section="System Monitor" />

      <Section title="System Status">
        {loading ? <div className="text-sm text-[var(--text-muted)]">Loading system monitor...</div> : null}
        {error ? <div className="rounded border border-red-400/40 bg-red-500/10 p-2 text-sm text-red-300">{error}</div> : null}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded border border-[var(--border-color)] p-3">
            <div className="text-xs text-[var(--text-muted)]">System</div>
            <div className="mt-1"><StatusPill value={data?.system || data?.system_status || 'unknown'} /></div>
          </div>
          <div className="rounded border border-[var(--border-color)] p-3">
            <div className="text-xs text-[var(--text-muted)]">Event Bus</div>
            <div className="mt-1"><StatusPill value={data?.event_bus || data?.event_bus_health?.status || (data?.event_bus_health?.logger_initialized ? 'ok' : 'warning')} /></div>
          </div>
          <div className="rounded border border-[var(--border-color)] p-3">
            <div className="text-xs text-[var(--text-muted)]">Alert Engine</div>
            <div className="mt-1"><StatusPill value={data?.alert_engine || data?.alert_engine_health?.status || 'unknown'} /></div>
          </div>
        </div>
      </Section>

      <Section title="Recent Events">
        <div className="mb-2 text-sm text-[var(--text-muted)]">{overview.events} recent events</div>
        <div className="max-h-64 overflow-auto rounded border border-[var(--border-color)]">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)]">
                <th className="px-2 py-1">Time</th>
                <th className="px-2 py-1">Type</th>
                <th className="px-2 py-1">Source</th>
                <th className="px-2 py-1">Symbol</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent_events || [])?.map((row) => (
                <tr key={`event-${row.id}`} className="border-t border-[var(--border-color)]">
                  <td className="px-2 py-1">{new Date(row.created_at).toLocaleTimeString()}</td>
                  <td className="px-2 py-1">{row.event_type}</td>
                  <td className="px-2 py-1">{row.source || '--'}</td>
                  <td className="px-2 py-1">{row.symbol || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Integrity Events">
          <div className="mb-2 text-sm text-[var(--text-muted)]">{overview.integrity} integrity items</div>
          <div className="space-y-2">
            {(data?.integrity_events || []).slice(0, 20)?.map((row) => (
              <div key={`integrity-${row.id}`} className="rounded border border-[var(--border-color)] p-2 text-sm">
                <div className="flex items-center justify-between">
                  <div>{row.symbol || 'N/A'} - {row.issue || row.event_type}</div>
                  <StatusPill value={row.severity || 'medium'} />
                </div>
                <div className="text-xs text-[var(--text-muted)]">{row.source || '--'} at {new Date(row.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Alerts">
          <div className="mb-2 text-sm text-[var(--text-muted)]">{overview.alerts} alerts</div>
          <div className="space-y-2">
            {(data?.system_alerts || []).slice(0, 20)?.map((row) => (
              <div key={`alert-${row.id}`} className="rounded border border-[var(--border-color)] p-2 text-sm">
                <div className="flex items-center justify-between">
                  <div>{row.type}</div>
                  <StatusPill value={row.severity} />
                </div>
                <div className="text-xs">{row.message}</div>
                <div className="text-xs text-[var(--text-muted)]">{row.source || '--'} at {new Date(row.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Providers">
          <div className="grid gap-2 md:grid-cols-2">
            {Object.entries(data?.provider_health || {})?.map(([name, provider]) => (
              <div key={name} className="rounded border border-[var(--border-color)] p-2 text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <div className="font-semibold uppercase">{name}</div>
                  <StatusPill value={provider?.status || 'unknown'} />
                </div>
                <div>Latency: {provider?.latency ?? '--'} ms</div>
                <div>Error rate: {provider?.error_rate ?? '--'}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Engines">
          <div className="grid gap-2 md:grid-cols-2">
            {Object.entries(data?.engine_health || {})?.map(([name, engine]) => (
              <div key={name} className="rounded border border-[var(--border-color)] p-2 text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <div className="font-semibold">{name}</div>
                  <StatusPill value={engine?.status || 'unknown'} />
                </div>
                <div>Last run: {engine?.last_run ? new Date(engine.last_run).toLocaleTimeString() : '--'}</div>
                <div>Exec: {Number(engine?.execution_time || 0)} ms</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Cache Status">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded border border-[var(--border-color)] p-3">
            <div className="text-xs text-[var(--text-muted)]">Ticker Cache</div>
            <div className="mt-1"><StatusPill value={data?.cache_health?.ticker_cache || 'unknown'} /></div>
          </div>
          <div className="rounded border border-[var(--border-color)] p-3">
            <div className="text-xs text-[var(--text-muted)]">Sparkline Cache Rows</div>
            <div className="mt-1 text-xl font-semibold">{Number(data?.cache_health?.sparkline_cache_rows || 0)}</div>
          </div>
          <div className="rounded border border-[var(--border-color)] p-3">
            <div className="text-xs text-[var(--text-muted)]">Cache Refresh</div>
            <div className="mt-1 text-sm">{data?.cache_health?.cache_refresh_time ? new Date(data?.cache_health.cache_refresh_time).toLocaleString() : '--'}</div>
          </div>
        </div>
      </Section>
    </div>
  );
}
