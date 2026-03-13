import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Database, Gauge, RadioTower } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout';
import MetricCard from '../../components/admin/MetricCard';
import HealthIndicator from '../../components/admin/HealthIndicator';
import SignalTrendChart from '../../components/admin/SignalTrendChart';
import { apiClient } from '../../api/apiClient';

function toNum(value) {
	const num = Number(value);
	return Number.isFinite(num) ? num : 0;
}

function statusFromLatency(ms) {
	if (ms <= 300) return 'healthy';
	if (ms <= 800) return 'warning';
	return 'failure';
}

function statusFromRate(rate) {
	if (rate >= 80) return 'healthy';
	if (rate >= 50) return 'warning';
	return 'failure';
}

export default function SystemDiagnostics() {
	const diagnosticsQuery = useQuery({
		queryKey: ['admin-system-monitor'],
		queryFn: () => apiClient('/system/monitor'),
		refetchInterval: 15000,
	});

	const monitor = diagnosticsQuery.data || {};

	const cards = useMemo(() => {
		const engineLatency = toNum(monitor?.engine_health?.opportunityIntelligence?.execution_time || monitor?.engine_health?.intelligencePipeline?.execution_time);
		const dbLatency = toNum(monitor?.database_latency_ms || monitor?.database_response_ms || monitor?.db_latency_ms || 0);
		const throughput = toNum(monitor?.events_per_second || monitor?.throughput_eps || (monitor?.recent_events || []).length);
		const providerHealthy = Object.values(monitor?.provider_health || {}).filter((provider) => {
			const status = String(provider?.status || '').toLowerCase();
			return status === 'ok' || status === 'healthy';
		}).length;
		const providerTotal = Object.keys(monitor?.provider_health || {}).length;
		const providerPct = providerTotal ? Math.round((providerHealthy / providerTotal) * 100) : 0;

		return {
			engineLatency,
			dbLatency,
			throughput,
			providerPct,
			providerHealthy,
			providerTotal,
		};
	}, [monitor]);

	const trendData = useMemo(() => {
		const recent = Array.isArray(monitor?.recent_events) ? monitor.recent_events.slice(0, 20).reverse() : [];
		return recent.map((item, idx) => ({
			label: `${idx + 1}`,
			value: toNum(item?.processing_ms || item?.latency_ms || 0),
		}));
	}, [monitor]);

	return (
		<AdminLayout title="System Diagnostics">
			<div className="space-y-4">
				{diagnosticsQuery.isLoading ? (
					<div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text-muted)]">
						Loading diagnostics telemetry...
					</div>
				) : null}

				{diagnosticsQuery.error ? (
					<div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
						Unable to load diagnostics endpoint. Check `/api/system/monitor` availability.
					</div>
				) : null}

				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
					<MetricCard
						title="Engine Latency"
						value={`${cards.engineLatency.toFixed(0)} ms`}
						subtitle="Core engine execution"
						status={statusFromLatency(cards.engineLatency)}
					/>
					<MetricCard
						title="Database Response"
						value={`${cards.dbLatency.toFixed(0)} ms`}
						subtitle="Round-trip query speed"
						status={statusFromLatency(cards.dbLatency)}
					/>
					<MetricCard
						title="Signal Throughput"
						value={`${cards.throughput.toFixed(0)} eps`}
						subtitle="Events processed"
						status={statusFromRate(cards.throughput)}
					/>
					<MetricCard
						title="Provider Health"
						value={`${cards.providerPct}%`}
						subtitle={`${cards.providerHealthy}/${cards.providerTotal || 0} healthy`}
						status={statusFromRate(cards.providerPct)}
					/>
				</div>

				<div className="grid gap-4 xl:grid-cols-2">
					<SignalTrendChart title="Engine Latency Trend" data={trendData} dataKey="value" color="#38bdf8" />

					<div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
						<h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Component Health</h3>
						<div className="grid gap-3 text-sm">
							<div className="flex items-center justify-between rounded border border-[var(--border-color)] p-2">
								<div className="flex items-center gap-2 text-[var(--text-secondary)]"><Gauge size={16} /> Engine Pipeline</div>
								<HealthIndicator status={cards.engineLatency ? statusFromLatency(cards.engineLatency) : 'warning'} />
							</div>
							<div className="flex items-center justify-between rounded border border-[var(--border-color)] p-2">
								<div className="flex items-center gap-2 text-[var(--text-secondary)]"><Database size={16} /> Database</div>
								<HealthIndicator status={cards.dbLatency ? statusFromLatency(cards.dbLatency) : 'warning'} />
							</div>
							<div className="flex items-center justify-between rounded border border-[var(--border-color)] p-2">
								<div className="flex items-center gap-2 text-[var(--text-secondary)]"><Activity size={16} /> Signal Throughput</div>
								<HealthIndicator status={statusFromRate(cards.throughput)} />
							</div>
							<div className="flex items-center justify-between rounded border border-[var(--border-color)] p-2">
								<div className="flex items-center gap-2 text-[var(--text-secondary)]"><RadioTower size={16} /> Providers</div>
								<HealthIndicator status={statusFromRate(cards.providerPct)} />
							</div>
						</div>
					</div>
				</div>

				<div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
					<h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Provider Status</h3>
					<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
						{Object.entries(monitor?.provider_health || {}).map(([name, provider]) => (
							<div key={name} className="rounded border border-[var(--border-color)] p-2">
								<div className="mb-2 flex items-center justify-between">
									<span className="text-sm font-semibold uppercase text-[var(--text-primary)]">{name}</span>
									<HealthIndicator status={provider?.status || 'unknown'} />
								</div>
								<div className="text-xs text-[var(--text-muted)]">Latency: {toNum(provider?.latency).toFixed(0)} ms</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</AdminLayout>
	);
}
