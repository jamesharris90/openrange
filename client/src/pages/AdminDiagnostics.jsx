import { useEffect, useMemo, useState } from 'react';
import { authFetchJSON } from '../utils/api';
import AdminLayout from '../components/layout/AdminLayout';

function statusTone(status) {
  if (status === 'ok') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (status === 'warning') return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return 'border-red-500/40 bg-red-500/10 text-red-300';
}

function cardStatus(count) {
  if (Number(count) > 0) return 'ok';
  return 'warning';
}

export default function AdminDiagnostics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [health, setHealth] = useState({ status: 'warning', database_health: { tables: {} }, provider_health: { providers: {} }, cache_health: {} });
  const [diagnostics, setDiagnostics] = useState({ lines: [], checked_at: null, health: null });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [healthPayload, enginePayload, providerPayload] = await Promise.all([
          authFetchJSON('/api/admin/diagnostics'),
          authFetchJSON('/api/admin/intelligence').catch(() => ({ ok: false })),
          authFetchJSON('/api/admin/providers').catch(() => ({ providers: {} })),
        ]);

        if (cancelled) return;
        setHealth({
          status: healthPayload?.telemetry ? 'ok' : 'warning',
          database_health: healthPayload?.database_health || { tables: {} },
          provider_health: providerPayload || { providers: {} },
          cache_health: { ticker_cache: healthPayload?.telemetry ? 'ok' : 'warning' },
        });
        setDiagnostics({
          lines: [
            `PIPELINE: ${enginePayload?.pipeline_runtime?.status || 'unknown'}`,
            `FLOW: ${enginePayload?.flow_runtime?.status || 'unknown'}`,
            `SQUEEZE: ${enginePayload?.squeeze_runtime?.status || 'unknown'}`,
            `OPPORTUNITY: ${enginePayload?.opportunity_runtime?.status || 'unknown'}`,
            `AVG ENGINE RUNTIME: ${Number(enginePayload?.avg_engine_runtime || 0)} ms`,
          ],
          checked_at: healthPayload?.checked_at || null,
          health: healthPayload,
          ok: true,
        });
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Diagnostics unavailable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(() => {
    const tables = health?.database_health?.tables || health?.tables || {};
    return [
      { label: 'Market Data', value: tables.intraday_1m ?? 0, status: cardStatus(tables.intraday_1m) },
      { label: 'News Feed', value: tables.news_articles ?? 0, status: cardStatus(tables.news_articles) },
      { label: 'Earnings Engine', value: tables.earnings_events ?? 0, status: cardStatus(tables.earnings_events) },
      { label: 'Strategy Engine', value: tables.trade_setups ?? 0, status: cardStatus(tables.trade_setups) },
      { label: 'Opportunity Engine', value: tables.opportunity_stream ?? 0, status: cardStatus(tables.opportunity_stream) },
    ];
  }, [health]);

  return (
    <div className="space-y-4">
      <AdminLayout section="Diagnostics" />

      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">System Diagnostics</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Database, API, engine, and scheduler health overview.</p>
      </div>

      <div className={`rounded-lg border p-3 text-sm ${statusTone(health?.status || 'warning')}`}>
        SYSTEM STATUS: {String(health?.status || 'warning').toUpperCase()}
      </div>

      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text-secondary)]">
        <div>Providers: {Object.values(health?.provider_health?.providers || {}).every((p) => p?.status === 'ok') ? 'OK' : 'Warning'}</div>
        <div>Cache: {(health?.cache_health?.ticker_cache || '').toLowerCase() === 'ok' ? 'OK' : 'Warning'}</div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text-muted)]">
          Loading diagnostics...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {cards?.map((card) => (
          <div key={card.label} className={`rounded-lg border p-3 ${statusTone(card.status)}`}>
            <p className="text-xs uppercase tracking-wide">{card.label}</p>
            <p className="mt-1 text-xl font-semibold">{Number(card.value || 0).toLocaleString()}</p>
            <p className="text-xs">{card.status === 'ok' ? 'OK' : 'Warning'}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
        <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">Engine Status</p>
        {(diagnostics?.lines || []).length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No engine diagnostics output.</p>
        ) : (
          <div className="space-y-1 text-sm text-[var(--text-secondary)]">
            {(diagnostics.lines || [])?.map((line, index) => (
              <div key={`${index}-${line}`}>{line}</div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text-secondary)]">
        <div>Database: {health?.status === 'ok' ? 'OK' : 'Warning'}</div>
        <div>API Health: {(diagnostics?.ok ?? true) ? 'OK' : 'Failed'}</div>
        <div>Scheduler Status: {(diagnostics?.checked_at || health?.status) ? 'Active' : 'Unknown'}</div>
      </div>
    </div>
  );
}
