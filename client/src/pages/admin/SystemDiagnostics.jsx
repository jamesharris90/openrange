import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import AdminLayout from '../../components/admin/AdminLayout';
import { authFetchJSON } from '../../utils/api';

const REFRESH_MS = 30_000;
const STATUS_STYLE = {
  green: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-400/40 bg-amber-500/10 text-amber-300',
  red: 'border-rose-400/40 bg-rose-500/10 text-rose-300',
};
const PIE_COLORS = ['#00c2ff', '#62d2a2', '#f8c14f', '#f28f6b', '#c879ff', '#ff5f87', '#8dc7ff'];

function toStatus(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'green' || normalized === 'ok') return 'green';
  if (normalized === 'amber' || normalized === 'warning' || normalized === 'degraded') return 'amber';
  return 'red';
}

function formatTimestamp(value) {
  if (!value) return 'No data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No data';
  return date.toLocaleString();
}

function formatDelay(seconds) {
  if (!Number.isFinite(Number(seconds))) return 'n/a';
  return `${Math.max(0, Number(seconds))}s`;
}

function formatHour(bucket) {
  if (!bucket) return '';
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ChartShell({ title, children }) {
  return (
    <section className="rounded-xl border border-slate-700/70 bg-slate-900/70 p-3 shadow-[0_12px_40px_rgba(2,6,23,0.45)] backdrop-blur-sm">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/90">{title}</h3>
      {children}
    </section>
  );
}

function StatusCard({ title, data }) {
  const status = toStatus(data?.status);
  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-950/60 p-4 shadow-[0_10px_28px_rgba(2,6,23,0.45)]">
      <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-slate-400">{title}</div>
      <div className="mb-3 text-sm text-slate-100">{formatTimestamp(data?.last_update)}</div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-slate-300">Delay: {formatDelay(data?.delay_seconds)}</div>
        <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wider ${STATUS_STYLE[status]}`}>
          {status}
        </span>
      </div>
    </div>
  );
}

export default function SystemDiagnostics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [health, setHealth] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [healthData, diagnosticsData] = await Promise.all([
          authFetchJSON('/api/system/health'),
          authFetchJSON('/api/system/diagnostics?hours=24'),
        ]);

        if (cancelled) return;

        setHealth(healthData || null);
        setDiagnostics(diagnosticsData || null);
        setError('');
        setLastRefresh(new Date().toISOString());
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Failed to load diagnostics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const cards = useMemo(() => {
    const freshness = health?.freshness || diagnostics?.freshness || {};
    return [
      { title: 'Market Data Freshness', data: freshness.intraday_1m || {} },
      { title: 'Signal Engine Status', data: freshness.flow_signals || {} },
      { title: 'Opportunity Engine Status', data: freshness.opportunity_stream || {} },
      { title: 'News Ingestion Status', data: freshness.news_articles || {} },
    ];
  }, [health, diagnostics]);

  const chartData = useMemo(() => {
    const flow = diagnostics?.charts?.flow_per_hour || [];
    const opportunities = diagnostics?.charts?.opportunities_per_hour || [];
    const news = diagnostics?.charts?.news_per_hour || [];

    return {
      flow: flow.map((row) => ({ label: formatHour(row.bucket), count: Number(row.count || 0) })),
      opportunities: opportunities.map((row) => ({ label: formatHour(row.bucket), count: Number(row.count || 0) })),
      news: news.map((row) => ({ label: formatHour(row.bucket), count: Number(row.count || 0) })),
    };
  }, [diagnostics]);

  const signalDistribution = useMemo(() => {
    return (diagnostics?.signal_type_distribution || []).map((row) => ({
      name: String(row.signal_type || 'unknown').toUpperCase(),
      value: Number(row.count || 0),
    }));
  }, [diagnostics]);

  const telemetryRows = useMemo(() => diagnostics?.engine_telemetry || [], [diagnostics]);
  const providerRows = useMemo(() => diagnostics?.provider_health || [], [diagnostics]);
  const eventRows = useMemo(() => (diagnostics?.system_events || []).slice(0, 6), [diagnostics]);

  return (
    <AdminLayout title="System Diagnostics">
      <div className="space-y-4 rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 text-slate-100 shadow-[0_16px_60px_rgba(2,6,23,0.55)] md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/70 bg-slate-950/55 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="relative inline-flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-50" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-300" />
            </span>
            <span className="text-xs uppercase tracking-[0.16em] text-cyan-200">Live Diagnostics</span>
          </div>
          <div className="text-xs text-slate-300">Updated: {formatTimestamp(lastRefresh)}</div>
        </div>

        {loading ? <div className="text-sm text-slate-300">Loading diagnostics...</div> : null}
        {error ? <div className="rounded-md border border-rose-400/40 bg-rose-500/10 p-2 text-sm text-rose-200">{error}</div> : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <StatusCard key={card.title} title={card.title} data={card.data} />
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          <ChartShell title="Signals Per Hour">
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData.flow}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" tick={{ fill: '#cbd5e1', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#cbd5e1', fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', color: '#e2e8f0' }} />
                  <Line type="monotone" dataKey="count" stroke="#22d3ee" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartShell>

          <ChartShell title="Opportunities Per Hour">
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData.opportunities}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" tick={{ fill: '#cbd5e1', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#cbd5e1', fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', color: '#e2e8f0' }} />
                  <Line type="monotone" dataKey="count" stroke="#34d399" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartShell>

          <ChartShell title="News Ingestion Per Hour">
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData.news}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" tick={{ fill: '#cbd5e1', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#cbd5e1', fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', color: '#e2e8f0' }} />
                  <Bar dataKey="count" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartShell>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <ChartShell title="Signal Type Distribution">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={signalDistribution}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={92}
                    paddingAngle={2}
                  >
                    {signalDistribution.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', color: '#e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </ChartShell>

          <ChartShell title="Recent System Events">
            <div className="max-h-64 overflow-auto rounded-md border border-slate-700/70">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-900/95 text-slate-300">
                  <tr>
                    <th className="px-2 py-2 text-left">Time</th>
                    <th className="px-2 py-2 text-left">Event</th>
                    <th className="px-2 py-2 text-left">Source</th>
                    <th className="px-2 py-2 text-left">Symbol</th>
                  </tr>
                </thead>
                <tbody>
                  {eventRows.map((row) => (
                    <tr key={`evt-${row.id}-${row.created_at}`} className="border-t border-slate-700/50 text-slate-200">
                      <td className="px-2 py-1.5">{formatTimestamp(row.created_at)}</td>
                      <td className="px-2 py-1.5">{row.event_type || '--'}</td>
                      <td className="px-2 py-1.5">{row.source || '--'}</td>
                      <td className="px-2 py-1.5">{row.symbol || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartShell>
        </div>

        <ChartShell title="Engine Telemetry">
          <div className="max-h-72 overflow-auto rounded-md border border-slate-700/70">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-900/95 text-slate-300">
                <tr>
                  <th className="px-2 py-2 text-left">Engine</th>
                  <th className="px-2 py-2 text-left">Last Update</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-right">Rows Processed</th>
                </tr>
              </thead>
              <tbody>
                {telemetryRows.map((row, index) => {
                  const status = toStatus(row.status);
                  return (
                    <tr key={`telemetry-${row.engine}-${index}`} className="border-t border-slate-700/50 text-slate-100">
                      <td className="px-2 py-1.5 font-semibold uppercase tracking-wide">{row.engine}</td>
                      <td className="px-2 py-1.5">{formatTimestamp(row.updated_at)}</td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded border px-2 py-0.5 text-[10px] uppercase ${STATUS_STYLE[status]}`}>{row.status || 'unknown'}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right">{Number(row.rows_processed || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartShell>

        <ChartShell title="Provider Health">
          <div className="grid gap-3 md:grid-cols-3">
            {['fmp', 'finnhub', 'polygon'].map((providerName) => {
              const row = providerRows.find((item) => String(item.provider || '').toLowerCase() === providerName) || {};
              const status = toStatus(row.status);
              return (
                <div key={providerName} className="rounded-lg border border-slate-700/70 bg-slate-950/55 p-3">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-slate-300">{providerName}</div>
                  <div className="mb-2 text-sm text-slate-100">Latency: {Number.isFinite(Number(row.latency)) ? `${Number(row.latency)} ms` : 'n/a'}</div>
                  <div className="mb-2">
                    <span className={`rounded border px-2 py-1 text-[10px] uppercase ${STATUS_STYLE[status]}`}>{row.status || 'unknown'}</span>
                  </div>
                  <div className="text-xs text-slate-400">Updated: {formatTimestamp(row.updated_at)}</div>
                </div>
              );
            })}
          </div>
        </ChartShell>
      </div>
    </AdminLayout>
  );
}
