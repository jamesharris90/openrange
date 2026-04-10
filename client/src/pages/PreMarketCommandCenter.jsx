import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../lib/apiClient';
import SignalCard from '../components/SignalCard';
import MarketContextBar from '../components/MarketContextBar';
import EarningsPanel from '../components/EarningsPanel';
import NewsPanel from '../components/NewsPanel';
import SectorPanel from '../components/SectorPanel';

function pickArray(...candidates) {
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) return candidate;
	}
	return [];
}

function toNumber(value, fallback = 0) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function parseHow(how) {
	if (how && typeof how === 'object') return how;
	if (typeof how === 'string') {
		try {
			const parsed = JSON.parse(how);
			return parsed && typeof parsed === 'object' ? parsed : null;
		} catch {
			return null;
		}
	}
	return null;
}

function normalizeSignal(raw = {}) {
	return {
		symbol: String(raw.symbol || '--').toUpperCase(),
		why: String(raw.why || raw.why_moving || '').trim(),
		how: parseHow(raw.how || raw.how_to_trade),
		confidence: toNumber(raw.confidence, 0),
		expected_move: toNumber(raw.expected_move ?? raw.expected_move_percent, 0),
		expectedMove: toNumber(raw.expected_move ?? raw.expected_move_percent, 0),
		move_percent: toNumber(raw.expected_move ?? raw.expected_move_percent, 0),
		signal_age_minutes: Number.isFinite(Number(raw.signal_age_minutes)) ? Number(raw.signal_age_minutes) : null,
		priority: String(raw.priority || 'LOW').toUpperCase(),
		sector: String(raw.sector || raw.sector_context || '').trim(),
		bias: raw.bias,
		historical_edge: Number.isFinite(Number(raw.historical_edge)) ? Number(raw.historical_edge) : 0.5,
	};
}

async function requestJSON(path) {
	const token = localStorage.getItem('openrange_token') || localStorage.getItem('authToken');
	const response = await fetch(`${API_BASE}${path}`, {
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
	});

	if (!response.ok) {
		throw new Error(`Request failed (${response.status}) for ${path}`);
	}

	return response.json();
}

export default function PreMarketCommandCenter() {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [signals, setSignals] = useState([]);
	const [earnings, setEarnings] = useState([]);
	const [news, setNews] = useState([]);
	const [sectors, setSectors] = useState([]);
	const [filters, setFilters] = useState({
		priority: 'ALL',
		minConfidence: 60,
		sector: 'ALL',
		maxAgeHours: 24,
	});

	useEffect(() => {
		let cancelled = false;

		async function load() {
			setLoading(true);
			setError('');

			try {
				const [signalsPayload, earningsPayload, newsPayload, sectorsPayload] = await Promise.all([
					requestJSON('/api/stocks-in-play?mode=research').catch(() => null),
					requestJSON('/api/earnings').catch(() => null),
					requestJSON('/api/intelligence/news').catch(() => null),
					requestJSON('/api/market/sectors').catch(() => null),
				]);

				if (cancelled) return;

				const nextSignals = pickArray(
					signalsPayload?.data,
					signalsPayload?.items,
					signalsPayload?.rows,
					signalsPayload
				)
					.map((row) => normalizeSignal(row))
					.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));

				const nextEarnings = pickArray(
					earningsPayload?.data,
					earningsPayload?.items,
					earningsPayload?.rows,
					earningsPayload
				);
				const nextNews = pickArray(newsPayload?.data, newsPayload?.items, newsPayload?.rows, newsPayload);
				const nextSectors = pickArray(
					sectorsPayload?.data,
					sectorsPayload?.items,
					sectorsPayload?.rows,
					sectorsPayload
				);

				setSignals(nextSignals);
				setEarnings(nextEarnings);
				setNews(nextNews);
				setSectors(nextSectors);
			} catch (loadError) {
				if (!cancelled) {
					setError(loadError?.message || 'Failed to load command center data.');
					setSignals([]);
					setEarnings([]);
					setNews([]);
					setSectors([]);
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		load();
		return () => {
			cancelled = true;
		};
	}, []);

	const sectorOptions = useMemo(() => {
		return Array.from(new Set(signals.map((signal) => signal.sector).filter(Boolean))).sort((a, b) => a.localeCompare(b));
	}, [signals]);

	const filteredSignals = useMemo(() => {
		return signals.filter((signal) => {
			if (filters.priority === 'HIGH' && signal.priority !== 'HIGH') return false;
			if (Number(signal.confidence || 0) < Number(filters.minConfidence || 0)) return false;
			if (filters.sector !== 'ALL' && signal.sector !== filters.sector) return false;
			if (Number.isFinite(signal.signal_age_minutes) && signal.signal_age_minutes > filters.maxAgeHours * 60) return false;
			return true;
		});
	}, [signals, filters]);

	const topSignals = filteredSignals.slice(0, 3);
	const restSignals = filteredSignals.slice(3);

	return (
		<div className="min-h-screen bg-slate-950 text-slate-100">
			<div className="grid grid-cols-12 gap-4 p-4">
				<MarketContextBar marketContext={{ data: sectors }} />

				<main className="col-span-12 space-y-4 xl:col-span-9">
					<section className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-[0_10px_28px_rgba(2,6,23,0.28)]">
						<h1 className="text-lg font-semibold tracking-tight text-slate-100">Pre-Market Command Center</h1>
						<p className="mt-1 text-sm text-slate-300">Ranked opportunities, execution context, and pre-market signal flow.</p>
					</section>

					<section className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-[0_10px_28px_rgba(2,6,23,0.28)]">
						<h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-cyan-200">Top Opportunities Today</h2>

						{loading ? <p className="mt-3 text-sm text-slate-400">Loading top opportunities...</p> : null}
						{!loading && error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}

						{!loading && !error && topSignals.length > 0 ? (
							<div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
								{topSignals.map((signal, index) => (
									<SignalCard key={`${signal.symbol}-${index}`} signal={signal} isTop />
								))}
							</div>
						) : null}

						{!loading && !error && signals.length === 0 ? (
							<p className="mt-3 text-sm text-slate-400">Market closed or no high-quality opportunities</p>
						) : null}
					</section>

					<section className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-[0_10px_28px_rgba(2,6,23,0.28)]">
						<div className="mb-3 flex flex-wrap items-center gap-2">
							<h2 className="mr-2 text-sm font-semibold uppercase tracking-[0.14em] text-cyan-200">Signal Grid</h2>

							<div className="inline-flex rounded-lg border border-slate-700/80 bg-slate-950/60 p-1 text-xs">
								<button
									type="button"
									className={`rounded-md px-2.5 py-1 ${filters.priority === 'ALL' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-300'}`}
									onClick={() => setFilters((previous) => ({ ...previous, priority: 'ALL' }))}
								>
									All
								</button>
								<button
									type="button"
									className={`rounded-md px-2.5 py-1 ${filters.priority === 'HIGH' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-300'}`}
									onClick={() => setFilters((previous) => ({ ...previous, priority: 'HIGH' }))}
								>
									High Only
								</button>
							</div>

							<label className="inline-flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-300">
								<span>Min Confidence: {filters.minConfidence}</span>
								<input
									type="range"
									min="60"
									max="95"
									step="1"
									value={filters.minConfidence}
									onChange={(event) => {
										const value = Number(event.target.value);
										setFilters((previous) => ({
											...previous,
											minConfidence: Number.isFinite(value) ? value : 60,
										}));
									}}
								/>
							</label>

							<select
								className="rounded-lg border border-slate-700/80 bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200"
								value={filters.sector}
								onChange={(event) => setFilters((previous) => ({ ...previous, sector: event.target.value }))}
							>
								<option value="ALL">All Sectors</option>
								{sectorOptions.map((sector) => (
									<option key={sector} value={sector}>{sector}</option>
								))}
							</select>

							<label className="inline-flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-300">
								<span>Max Age</span>
								<select
									className="rounded border border-slate-700/80 bg-slate-950/80 px-1.5 py-0.5 text-xs text-slate-200"
									value={filters.maxAgeHours}
									onChange={(event) => {
										const value = Number(event.target.value);
										setFilters((previous) => ({ ...previous, maxAgeHours: Number.isFinite(value) ? value : 24 }));
									}}
								>
									<option value={6}>6h</option>
									<option value={12}>12h</option>
									<option value={24}>24h</option>
									<option value={48}>48h</option>
								</select>
							</label>

							<span className="text-xs text-slate-400">
								Showing {filteredSignals.length} of {signals.length} opportunities
							</span>
						</div>

						{!loading && !error && restSignals.length > 0 ? (
							<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
								{restSignals.map((signal, index) => (
									<SignalCard key={`${signal.symbol}-rest-${index}`} signal={signal} />
								))}
							</div>
						) : null}

						{!loading && !error && signals.length === 0 ? (
							<p className="text-sm text-slate-400">Market closed or no high-quality opportunities</p>
						) : null}

						{!loading && !error && signals.length > 0 && filteredSignals.length === 0 ? (
							<p className="text-sm text-slate-400">No matches for current filters.</p>
						) : null}
					</section>
				</main>

				<aside className="col-span-12 space-y-4 xl:col-span-3">
					<EarningsPanel earnings={earnings} />
					<NewsPanel news={news} />
					<SectorPanel sectors={sectors} />
				</aside>
			</div>
		</div>
	);
}
