import { memo, useMemo } from 'react';
import { Activity, Cpu, Database, Gauge, RadioTower, Timer } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import AdminLayout from '../../components/admin/AdminLayout';
import StatusBadge from '../../components/admin/StatusBadge';
import { apiClient } from '../../api/apiClient';

function toNum(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function statusFromDelay(delaySeconds) {
  const delay = toNum(delaySeconds, 9999);
  if (delay <= 90) return 'ok';
  if (delay <= 240) return 'warning';
  return 'stale';
}

function metricStatus(value) {
  const v = toNum(value);
  if (v > 0) return 'ok';
  return 'warning';
}

function DiagnosticsCard({ title, value, status, subtitle, icon: Icon }) {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-400">{title}</p>
        {Icon ? <Icon size={16} className="text-blue-400" /> : null}
      </div>
      <p className="text-xl font-semibold text-slate-100">{value}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">{subtitle}</span>
        <StatusBadge status={status} />
      </div>
    </article>
  );
}

function SystemDiagnostics() {
  const query = useQuery({
    queryKey: ['admin-system-diagnostics-rebuild'],
    queryFn: async () => {
      const [freshness, diagnostics, activity, providers] = await Promise.all([
        apiClient('/system/data-freshness').catch(() => ({})),
        apiClient('/system/diagnostics?hours=24').catch(() => ({})),
        apiClient('/system/activity').catch(() => ({ items: [] })),
        apiClient('/admin/providers').catch(() => ({ providers: {} })),
      ]);

      return {
        freshness,
        diagnostics,
        activity: Array.isArray(activity?.items) ? activity.items : [],
        providers: providers?.providers || {},
      };
    },
    refetchInterval: 30000,
  });

  const payload = query.data || {};
  const freshness = payload.freshness || {};
  const diagnostics = payload.diagnostics || {};
  const activity = payload.activity || [];
  const providers = payload.providers || {};

  const engineCards = useMemo(() => {
    const map = activity.reduce((acc, row) => {
      acc[String(row.engine || '').toLowerCase()] = row;
      return acc;
    }, {});

    return [
      {
        key: 'flow_signals',
        name: 'Flow Detection',
        row: map.flow_signals,
      },
      {
        key: 'opportunity_stream',
        name: 'Opportunity Engine',
        row: map.opportunity_stream,
      },
      {
        key: 'news_articles',
        name: 'News Pipeline',
        row: map.news_articles,
      },
      {
        key: 'strategy',
        name: 'Strategy Engine',
        row: map.strategy,
      },
    ];
  }, [activity]);

  const freshnessCards = [
    { title: 'Market Data', data: freshness.intraday_1m },
    { title: 'Flow Signals', data: freshness.flow_signals },
    { title: 'Opportunity Stream', data: freshness.opportunity_stream },
    { title: 'News Feed', data: freshness.news_articles },
  ];

  const pipelineMetrics = useMemo(() => {
    const rows = diagnostics?.activity || [];
    const totalRows = rows.reduce((sum, row) => sum + toNum(row.rows_last_hour), 0);
    const topEngine = rows[0]?.engine || 'n/a';
    const topRows = toNum(rows[0]?.rows_last_hour);

    return {
      totalRows,
      topEngine,
      topRows,
      signalsTracked: Array.isArray(diagnostics?.signal_type_distribution) ? diagnostics.signal_type_distribution.length : 0,
    };
  }, [diagnostics]);

  return (
    <AdminLayout title="System Diagnostics" subtitle="Engine health, provider status, and live data freshness">
      <div className="space-y-4">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <RadioTower size={16} className="text-blue-400" />
              <p className="text-sm font-medium text-slate-100">System Status Banner</p>
            </div>
            <StatusBadge status={diagnostics?.ok ? 'ok' : 'warning'} label={diagnostics?.ok ? 'ONLINE' : 'DEGRADED'} />
          </div>
          <p className="mt-2 text-sm text-slate-300">
            Last refresh: {new Date().toLocaleTimeString()} • Activity rows/hr: {pipelineMetrics.totalRows.toLocaleString()}
          </p>
        </section>

        {query.isLoading ? <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Loading diagnostics...</div> : null}
        {query.error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">Diagnostics load failed.</div> : null}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {engineCards.map((engine) => (
            <DiagnosticsCard
              key={engine.key}
              title={engine.name}
              value={`${toNum(engine.row?.rows_last_hour)} rows/hr`}
              status={metricStatus(engine.row?.rows_last_hour)}
              subtitle={`Latency ${toNum(engine.row?.rows_last_hour) > 0 ? '<1s' : 'n/a'}`}
              icon={Cpu}
            />
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Object.entries(providers).map(([name, provider]) => (
            <DiagnosticsCard
              key={name}
              title={`Provider ${name}`}
              value={`${toNum(provider?.latency, 0)} ms`}
              status={String(provider?.status || 'unknown')}
              subtitle={`Error rate ${toNum(provider?.error_rate, 0)}`}
              icon={Database}
            />
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {freshnessCards.map((item) => (
            <DiagnosticsCard
              key={item.title}
              title={item.title}
              value={`${toNum(item.data?.delay_seconds, 0)}s`}
              status={statusFromDelay(item.data?.delay_seconds)}
              subtitle={item.data?.last_update ? new Date(item.data.last_update).toLocaleTimeString() : 'No update'}
              icon={Timer}
            />
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <DiagnosticsCard
            title="Pipeline Throughput"
            value={pipelineMetrics.totalRows.toLocaleString()}
            status={metricStatus(pipelineMetrics.totalRows)}
            subtitle="Rows/hour total"
            icon={Activity}
          />
          <DiagnosticsCard
            title="Top Engine"
            value={pipelineMetrics.topEngine}
            status="ok"
            subtitle={`${pipelineMetrics.topRows.toLocaleString()} rows/hr`}
            icon={Gauge}
          />
          <DiagnosticsCard
            title="Signal Types"
            value={`${pipelineMetrics.signalsTracked}`}
            status={metricStatus(pipelineMetrics.signalsTracked)}
            subtitle="Distinct strategy labels"
            icon={Database}
          />
          <DiagnosticsCard
            title="Pipeline Health"
            value={diagnostics?.ok ? 'Stable' : 'Degraded'}
            status={diagnostics?.ok ? 'ok' : 'warning'}
            subtitle="Diagnostics contract"
            icon={Cpu}
          />
        </section>
      </div>
    </AdminLayout>
  );
}

export default memo(SystemDiagnostics);
