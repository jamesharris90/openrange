import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';
import MarketTickerBar from '../components/market/MarketTickerBar';
import MarketRegimePanel from '../components/premarket/MarketRegimePanel';
import GapLeaders from '../components/premarket/GapLeaders';
import TopStrategies from '../components/premarket/TopStrategies';
import DeepDivePanel from '../components/premarket/DeepDivePanel';
import EarningsPanel from '../components/premarket/EarningsPanel';
import VolumeSurges from '../components/premarket/VolumeSurges';

function extractRows(payload, key) {
	if (Array.isArray(payload?.[key])) return payload[key];
	if (Array.isArray(payload?.items)) return payload.items;
	if (Array.isArray(payload?.data)) return payload.data;
	return [];
}

export default function PreMarketCommand() {
	const navigate = useNavigate();
	const [loading, setLoading] = useState(true);
	const [summary, setSummary] = useState(null);
	const [narrative, setNarrative] = useState(null);
	const [selectedTicker, setSelectedTicker] = useState('SPY');

	useEffect(() => {
		let cancelled = false;

		async function load() {
			setLoading(true);
			try {
				const [summaryPayload, narrativePayload] = await Promise.all([
					apiJSON('/api/premarket/summary'),
					apiJSON('/api/intelligence/market-narrative').catch(() => apiJSON('/api/market-narrative').catch(() => null)),
				]);

				if (cancelled) return;
				setSummary(summaryPayload || null);
				setNarrative(narrativePayload || null);
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		load();
		return () => {
			cancelled = true;
		};
	}, []);

	const gapLeaders = useMemo(() => extractRows(summary, 'gap_leaders'), [summary]);
	const topSetups = useMemo(() => extractRows(summary, 'top_setups'), [summary]);
	const earnings = useMemo(() => extractRows(summary, 'earnings'), [summary]);
	const volumeSurges = useMemo(() => extractRows(summary, 'volume_surges'), [summary]);
	const catalysts = useMemo(() => extractRows(summary, 'catalysts'), [summary]);

	return (
		<PageContainer className="space-y-3">
			<MarketTickerBar />

			<Card>
				<PageHeader
					title="Pre-Market Command Center"
					subtitle="What is the environment, which tickers matter, and how they should be traded."
				/>
			</Card>

			{loading ? (
				<Card><LoadingSpinner message="Loading pre-market intelligence..." /></Card>
			) : (
				<>
					<MarketRegimePanel marketContext={summary?.market_context} narrative={narrative} />

					<div className="grid gap-3 lg:grid-cols-[minmax(0,60%)_minmax(0,40%)]">
						<div className="space-y-3">
							<GapLeaders rows={gapLeaders} onSelectTicker={setSelectedTicker} />

							<div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
								<h3 className="m-0 mb-3 text-sm font-semibold">Catalyst Leaders</h3>
								<div className="space-y-2">
									{catalysts.slice(0, 8).map((row, index) => {
										const symbol = String(row?.symbol || row?.detected_symbols?.[0] || '').toUpperCase();
										return (
											<button
												key={`${symbol}-${index}`}
												type="button"
												onClick={() => setSelectedTicker(symbol)}
												className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-left text-xs"
											>
												<div className="flex items-center justify-between">
													<span className="font-semibold">{symbol || 'MARKET'}</span>
													<span className="text-[var(--text-muted)]">{row?.sentiment || 'neutral'}</span>
												</div>
												<div>{row?.headline || 'No headline'}</div>
											</button>
										);
									})}
								</div>
							</div>

							<TopStrategies rows={topSetups} onSelectTicker={setSelectedTicker} onExpandWatchlist={() => navigate('/watchlist')} />
						</div>

						<div className="space-y-3">
							<DeepDivePanel selectedTicker={selectedTicker} />
							<EarningsPanel rows={earnings} onSelectTicker={setSelectedTicker} />
							<VolumeSurges rows={volumeSurges} onSelectTicker={setSelectedTicker} />
						</div>
					</div>
				</>
			)}
		</PageContainer>
	);
}
