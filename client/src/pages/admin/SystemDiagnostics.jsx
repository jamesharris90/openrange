import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';

async function fetchEndpoint(url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Request failed: ${response.status}`);
	}
	return response.json();
}

function formatTimestamp(value) {
	if (!value) return 'Unavailable';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toLocaleString();
}

function DetailRow({ label, value }) {
	return (
		<div className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] py-2 last:border-b-0">
			<span className="text-sm text-[var(--text-secondary)]">{label}</span>
			<span className="text-right text-sm font-medium text-[var(--text-primary)]">{value ?? 'Unavailable'}</span>
		</div>
	);
}

function DiagnosticsCard({ title, children }) {
	return (
		<section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 shadow-sm">
			<h2 className="mb-3 text-base font-semibold text-[var(--text-primary)]">{title}</h2>
			<div>{children}</div>
		</section>
	);
}

function SystemDiagnostics() {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [diagnostics, setDiagnostics] = useState({
		dataFreshness: null,
		engineStatus: null,
		providerLatency: null,
		uiErrors: null,
		emailStatus: null,
	});

	useEffect(() => {
		let cancelled = false;

		async function loadDiagnostics() {
			setLoading(true);
			setError('');

			const [dataFreshness, engineStatus, providerLatency, uiErrors, emailStatus] = await Promise.allSettled([
				fetchEndpoint('/api/system/data-freshness'),
				fetchEndpoint('/api/system/engine-status'),
				fetchEndpoint('/api/system/provider-latency'),
				fetchEndpoint('/api/system/ui-errors'),
				fetchEndpoint('/api/system/email-status'),
			]);

			if (cancelled) return;

			setDiagnostics({
				dataFreshness: dataFreshness.status === 'fulfilled' ? dataFreshness.value : null,
				engineStatus: engineStatus.status === 'fulfilled' ? engineStatus.value : null,
				providerLatency: providerLatency.status === 'fulfilled' ? providerLatency.value : null,
				uiErrors: uiErrors.status === 'fulfilled' ? uiErrors.value : null,
				emailStatus: emailStatus.status === 'fulfilled' ? emailStatus.value : null,
			});

			const failed = [dataFreshness, engineStatus, providerLatency, uiErrors, emailStatus].filter((result) => result.status === 'rejected').length;
			if (failed > 0) {
				setError(`Some diagnostics endpoints failed to load (${failed}/5).`);
			}

			setLoading(false);
		}

		loadDiagnostics().catch(() => {
			if (cancelled) return;
			setError('Unable to load diagnostics data.');
			setLoading(false);
		});

		return () => {
			cancelled = true;
		};
	}, []);

	const dataFreshness = useMemo(() => diagnostics.dataFreshness || {}, [diagnostics.dataFreshness]);
	const engineStatus = useMemo(() => diagnostics.engineStatus || {}, [diagnostics.engineStatus]);
	const providerLatency = useMemo(() => diagnostics.providerLatency || {}, [diagnostics.providerLatency]);
	const uiErrors = useMemo(() => diagnostics.uiErrors || {}, [diagnostics.uiErrors]);
	const emailStatus = useMemo(() => diagnostics.emailStatus || {}, [diagnostics.emailStatus]);

	return (
		<AdminLayout title="System Diagnostics">
			<div className="space-y-4">
				{loading ? (
					<div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text-muted)]">
						Loading diagnostics...
					</div>
				) : null}

				{error ? (
					<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
						{error}
					</div>
				) : null}

				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					<DiagnosticsCard title="Data Freshness">
						<DetailRow label="intraday_1m last update" value={formatTimestamp(dataFreshness?.intraday_1m_last_update || dataFreshness?.intraday_1m)} />
						<DetailRow label="daily_ohlc last update" value={formatTimestamp(dataFreshness?.daily_ohlc_last_update || dataFreshness?.daily_ohlc)} />
					</DiagnosticsCard>

					<DiagnosticsCard title="Engine Status">
						<DetailRow label="ingestion engine" value={engineStatus?.ingestion_engine || engineStatus?.ingestion || 'Unknown'} />
						<DetailRow label="strategy engine" value={engineStatus?.strategy_engine || engineStatus?.strategy || 'Unknown'} />
						<DetailRow label="intelligence engine" value={engineStatus?.intelligence_engine || engineStatus?.intelligence || 'Unknown'} />
					</DiagnosticsCard>

					<DiagnosticsCard title="Provider Latency">
						<DetailRow label="FMP" value={providerLatency?.fmp_ms != null ? `${providerLatency.fmp_ms} ms` : providerLatency?.fmp || 'Unavailable'} />
						<DetailRow label="Finnhub" value={providerLatency?.finnhub_ms != null ? `${providerLatency.finnhub_ms} ms` : providerLatency?.finnhub || 'Unavailable'} />
						<DetailRow label="Finviz" value={providerLatency?.finviz_ms != null ? `${providerLatency.finviz_ms} ms` : providerLatency?.finviz || 'Unavailable'} />
					</DiagnosticsCard>

					<DiagnosticsCard title="UI Error Count">
						<DetailRow label="last 24h error count" value={uiErrors?.last_24h_error_count ?? uiErrors?.count_24h ?? '0'} />
					</DiagnosticsCard>

					<DiagnosticsCard title="Email System Status">
						<DetailRow label="Resend status" value={emailStatus?.resend_status || emailStatus?.status || 'Unknown'} />
						<DetailRow label="queued emails" value={emailStatus?.queued_emails ?? emailStatus?.queue_size ?? '0'} />
					</DiagnosticsCard>
				</div>
			</div>
		</AdminLayout>
	);
}

export default SystemDiagnostics;
