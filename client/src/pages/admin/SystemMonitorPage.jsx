import { memo, useMemo } from 'react';
import { Activity, Cpu, Gauge, Layers, Radio, Server } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import AdminLayout from '../../components/admin/AdminLayout';
import StatusBadge from '../../components/admin/StatusBadge';
import { apiClient } from '../../api/apiClient';

function toNum(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function metricPercent(value, max = 100) {
  return Math.max(0, Math.min(100, Math.round((toNum(value) / Math.max(max, 1)) * 100)));
}

function MiniProgress({ value }) {
  return (
    <div className="h-2 rounded bg-slate-800">
      <div className="h-2 rounded bg-blue-400" style={{ width: `${Math.max(2, value)}%` }} />
    </div>
  );
}

function MetricBox({ title, value, status, icon: Icon, progress = 0, subtitle }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-400">{title}</div>
        {Icon ? <Icon size={16} className="text-blue-400" /> : null}
      </div>
      <div className="mb-2 text-xl font-semibold text-slate-100">{value}</div>
      <MiniProgress value={progress} />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">{subtitle}</span>
        <StatusBadge status={status} />
      </div>
    </div>
  );
}

function SystemMonitorPage() {
  const query = useQuery({
    queryKey: ['admin-system-monitor-rebuild'],
    queryFn: async () => {
      const primary = await apiClient('/system/monitor').catch(() => null);
      const fallback = await apiClient('/admin/system').catch(() => ({}));
      return primary?.data || primary || fallback || {};
    },
    refetchInterval: 15000,
  });

  const data = query.data || {};

  const telemetry = useMemo(() => {
    const events = Array.isArray(data.recent_events) ? data.recent_events.length : 0;
    const integrity = Array.isArray(data.integrity_events) ? data.integrity_events.length : 0;
    const alerts = Array.isArray(data.system_alerts) ? data.system_alerts.length : 0;
    return { events, integrity, alerts };
  }, [data]);

  const providers = useMemo(() => {
    const raw = data.provider_health || {};
    return Object.entries(raw).slice(0, 8);
  }, [data]);

  const queueDepth = telemetry.events + telemetry.integrity;
  const throughput = telemetry.events;

  return (
    <AdminLayout title="System Activity" subtitle="Pipeline telemetry, runtime metrics, queue depth, and provider health">
      <div className="space-y-4">
        {query.isLoading ? <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Loading system activity...</div> : null}
        {query.error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">Unable to fetch monitor metrics.</div> : null}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricBox
            title="Pipeline Telemetry"
            value={String(data.system_status || data.system || 'unknown').toUpperCase()}
            status={data.system_status || data.system || 'unknown'}
            subtitle="System runtime"
            progress={metricPercent(data.engines_running, 8)}
            icon={Radio}
          />
          <MetricBox
            title="Engine Runtime Metrics"
            value={`${toNum(data.engines_running)} running`}
            status={toNum(data.engines_running) > 0 ? 'ok' : 'warning'}
            subtitle="Engine scheduler"
            progress={metricPercent(data.engines_running, 8)}
            icon={Cpu}
          />
          <MetricBox
            title="Queue Depth"
            value={`${queueDepth}`}
            status={queueDepth < 200 ? 'ok' : 'warning'}
            subtitle="Events + integrity"
            progress={metricPercent(queueDepth, 300)}
            icon={Layers}
          />
          <MetricBox
            title="Event Throughput"
            value={`${throughput}/window`}
            status={throughput > 0 ? 'ok' : 'warning'}
            subtitle="Recent events"
            progress={metricPercent(throughput, 120)}
            icon={Activity}
          />
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Server size={16} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-100">Provider Health</h2>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {providers.map(([name, provider]) => (
              <div key={name} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-slate-400">{name}</p>
                  <StatusBadge status={provider?.status || 'unknown'} />
                </div>
                <p className="text-sm text-slate-200">Latency: {toNum(provider?.latency)} ms</p>
                <p className="text-xs text-slate-400">Error rate: {toNum(provider?.error_rate).toFixed(3)}</p>
                <div className="mt-2">
                  <MiniProgress value={metricPercent(100 - toNum(provider?.error_rate) * 100, 100)} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricBox
            title="Alerts"
            value={`${telemetry.alerts}`}
            status={telemetry.alerts < 10 ? 'ok' : 'warning'}
            subtitle="System alerts"
            progress={metricPercent(telemetry.alerts, 30)}
            icon={Gauge}
          />
          <MetricBox
            title="Integrity Events"
            value={`${telemetry.integrity}`}
            status={telemetry.integrity < 20 ? 'ok' : 'warning'}
            subtitle="Data quality"
            progress={metricPercent(telemetry.integrity, 60)}
            icon={Gauge}
          />
          <MetricBox
            title="Cache Rows"
            value={`${toNum(data.cache_health?.sparkline_cache_rows)}`}
            status={toNum(data.cache_health?.sparkline_cache_rows) > 0 ? 'ok' : 'warning'}
            subtitle="Sparkline cache"
            progress={metricPercent(data.cache_health?.sparkline_cache_rows, 1000)}
            icon={Layers}
          />
          <MetricBox
            title="Ticker Cache"
            value={String(data.cache_health?.ticker_cache || 'unknown').toUpperCase()}
            status={data.cache_health?.ticker_cache || 'unknown'}
            subtitle="Cache health"
            progress={data.cache_health?.ticker_cache === 'ok' ? 100 : 35}
            icon={Radio}
          />
        </section>
      </div>
    </AdminLayout>
  );
}

export default memo(SystemMonitorPage);
