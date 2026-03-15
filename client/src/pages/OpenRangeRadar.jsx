import { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { PageContainer } from '../components/layout/PagePrimitives';
import { apiClient } from '../api/apiClient';
import SignalCard from '../components/cards/SignalCard';
import OpportunityCard from '../components/cards/OpportunityCard';
import NewsCatalystCard from '../components/cards/NewsCatalystCard';
import SectorMomentumCard from '../components/cards/SectorMomentumCard';
import MarketBreadthCard from '../components/cards/MarketBreadthCard';
import useBeaconSignalMap from '../hooks/beacon/useBeaconSignalMap';
import BeaconSignalInline from '../components/beacon/BeaconSignalInline';
import useBeaconOverlayVisibility from '../hooks/beacon/useBeaconOverlayVisibility';
import BeaconOverlayStatusChip from '../components/beacon/BeaconOverlayStatusChip';
import { safeArray, safeObject } from '../utils/safeData';
import { adaptRadarPayload } from '../adapters/radarAdapter';

function pickArray(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return safeArray(candidate);
  }
  return [];
}

export default function OpenRangeRadarPage() {
  const [compactMode, setCompactMode] = useState(false);
  const { showBeaconSignals, toggleBeaconSignals } = useBeaconOverlayVisibility('radar', true);

  const { data, isLoading } = useQuery({
    queryKey: ['market-radar-cards'],
    queryFn: async () => {
      const [summary, opportunities, signals, news, sectors] = await Promise.all([
        apiClient('/radar/summary').catch(() => ({})),
        apiClient('/opportunities?limit=24').catch(() => ({ items: [] })),
        apiClient('/intelligence/flow?limit=24').catch(() => ({ items: [] })),
        apiClient('/news/v3?limit=24&sort=score').catch(() => ([])),
        apiClient('/market/sector-strength').catch(() => ([])),
      ]);

      return adaptRadarPayload({
        summary: summary || {},
        opportunities: pickArray(opportunities?.data, opportunities?.items, opportunities?.rows, opportunities),
        signals: pickArray(signals?.data, signals?.items, signals?.rows, signals),
        news: pickArray(news?.data, news, news?.items),
        sectors: pickArray(sectors?.data, sectors, sectors?.items, sectors?.rows),
      });
    },
    refetchInterval: 30000,
  });

  const radarData = safeObject(data);
  const opportunities = safeArray(radarData.opportunities);
  const signals = safeArray(radarData.signals);
  const news = safeArray(radarData.news);
  const sectors = safeArray(radarData.sectors);

  const stats = useMemo(() => ({
    opportunities: opportunities.length,
    signals: signals.length,
    news: news.length,
    sectors: sectors.length,
  }), [opportunities, signals, news, sectors]);

  const visibleSymbols = useMemo(() => {
    if (!data) return [];

    if (compactMode) {
      return signals.slice(0, 12).map((item) => item?.symbol).filter(Boolean);
    }

    return [
      ...signals.slice(0, 8).map((item) => item?.symbol),
      ...opportunities.slice(0, 9).map((item) => item?.symbol),
      ...news.slice(0, 8).map((item) => item?.symbol),
    ].filter(Boolean);
  }, [data, compactMode, signals, opportunities, news]);

  const { getSignal } = useBeaconSignalMap({
    symbols: visibleSymbols,
    enabled: showBeaconSignals,
  });

  const radarOverlaySignals = useMemo(() => {
    if (!showBeaconSignals) return [];
    const seen = new Set();
    const found = [];
    const symbolPool = [
      ...opportunities.map((item) => item?.symbol),
      ...signals.map((item) => item?.symbol),
      ...news.map((item) => item?.symbol),
    ];

    for (const symbol of symbolPool) {
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      const signal = getSignal(symbol);
      if (signal) found.push(signal);
      if (found.length >= 6) break;
    }

    return found;
  }, [showBeaconSignals, opportunities, signals, news, getSignal]);
  const activeBeaconSymbolCount = showBeaconSignals ? radarOverlaySignals.length : 0;

  const compactRows = useMemo(() => {
    return [
      ...opportunities.slice(0, 8),
      ...signals.slice(0, 8),
      ...news.slice(0, 8),
    ];
  }, [opportunities, signals, news]);

  useEffect(() => {
    document.title = 'OpenRange Radar';
  }, []);

  return (
    <PageContainer className="space-y-4">
      <section className="rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-slate-700 bg-slate-800/70 p-2 text-emerald-400">
            <Activity size={18} />
          </div>
          <div>
            <h1 className="m-0 text-xl font-semibold tracking-tight text-slate-100">OpenRange Radar</h1>
            <p className="m-0 mt-1 text-sm text-slate-400">
              Command center for what is moving, why it is moving, and how it can be traded.
            </p>
            <p className="m-0 mt-2 text-xs text-slate-500">
              Opportunities: {stats.opportunities} • Signals: {stats.signals} • News: {stats.news} • Sectors: {stats.sectors}
            </p>
          </div>
          <div className="ml-auto">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleBeaconSignals}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
              >
                {showBeaconSignals ? 'Hide Beacon Signals' : 'Show Beacon Signals'}
              </button>
              <BeaconOverlayStatusChip isEnabled={showBeaconSignals} activeSymbols={activeBeaconSymbolCount} />
              <button
                type="button"
                onClick={() => setCompactMode((current) => !current)}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
              >
                {compactMode ? 'Card Mode' : 'Compact Table Mode'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {isLoading ? <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Loading radar intelligence...</div> : null}

      {!isLoading && showBeaconSignals && radarOverlaySignals.length ? (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-100">Beacon Overlays</h2>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {radarOverlaySignals.map((signal, idx) => (
              <BeaconSignalInline key={`${signal.symbol || 'radar-signal'}-${idx}`} signal={signal} title={`Beacon Overlay • ${signal.symbol}`} />
            ))}
          </div>
        </section>
      ) : null}

      {!compactMode ? (
        <>
          <section className="grid gap-4 xl:grid-cols-2">
            {sectors.slice(0, 6).map((sector, idx) => (
              <SectorMomentumCard key={`${sector.sector || sector.name || 'sector'}-${idx}`} sector={sector} />
            ))}
            <MarketBreadthCard data={data?.summary?.breadth || data?.summary || {}} />
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            {opportunities.slice(0, 9).map((item, idx) => (
              <OpportunityCard key={`${item.symbol || 'opp'}-${idx}`} item={item} />
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            {signals.slice(0, 8).map((signal, idx) => (
              <SignalCard key={`${signal.symbol || 'signal'}-${idx}`} signal={signal} />
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            {news.slice(0, 8).map((item, idx) => (
              <NewsCatalystCard key={`${item.id || item.symbol || 'news'}-${idx}`} item={item} />
            ))}
          </section>
        </>
      ) : (
        <section className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-100">Terminal Rows</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs text-slate-300">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="px-2 py-1">Symbol</th>
                    <th className="px-2 py-1">Confidence</th>
                    <th className="px-2 py-1">Expected Move</th>
                    <th className="px-2 py-1">Catalyst</th>
                    <th className="px-2 py-1">Sector</th>
                  </tr>
                </thead>
                <tbody>
                  {compactRows.slice(0, 12).map((row, idx) => (
                    <tr key={`${row.symbol || 'r'}-${idx}`} className="border-t border-slate-800">
                      <td className="px-2 py-1 text-slate-100">{row.symbol || '--'}</td>
                      <td className="px-2 py-1">{Number(row.confidence ?? row.score ?? row.news_score ?? 0).toFixed(1)}</td>
                      <td className="px-2 py-1">{row.expected_move ?? row.expectedMove ?? '--'}</td>
                      <td className="px-2 py-1">{row.catalyst_summary ?? row.catalyst ?? row.headline ?? '--'}</td>
                      <td className="px-2 py-1">{row.sector_context ?? row.sector ?? '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </PageContainer>
  );
}
