import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/apiClient';
import SectorMomentumCard from '../../components/cards/SectorMomentumCard';
import MarketBreadthCard from '../../components/cards/MarketBreadthCard';
import OpportunityCard from '../../components/cards/OpportunityCard';
import SignalCard from '../../components/cards/SignalCard';
import NewsCatalystCard from '../../components/cards/NewsCatalystCard';
import StrategyScoreCard from '../../components/cards/StrategyScoreCard';
import BeaconOverlayStatusChip from '../../components/beacon/BeaconOverlayStatusChip';
import useBeaconOverlayVisibility from '../../hooks/beacon/useBeaconOverlayVisibility';
import useBeaconSignalMap from '../../hooks/beacon/useBeaconSignalMap';

function toItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function useSectionInView() {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const target = ref.current;
    if (!target || isVisible) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px 0px' },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [isVisible]);

  return { ref, isVisible };
}

function SectionFrame({ title, children, isVisible, sectionRef }) {
  return (
    <section ref={sectionRef} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-100">{title}</h2>
        <span className="text-[11px] text-slate-400">{isVisible ? 'Live' : 'Standby'}</span>
      </div>
      {children}
    </section>
  );
}

function LoadingBlock({ message }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
      {message}
    </div>
  );
}

function SkeletonCard({ className = 'h-44' }) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900 p-4 ${className}`.trim()}>
      <div className="h-full animate-pulse rounded-lg bg-slate-800/70" />
    </div>
  );
}

function MarketContextSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SkeletonCard className="h-44" />
        <SkeletonCard className="h-44" />
        <SkeletonCard className="h-44" />
        <SkeletonCard className="h-44" />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SkeletonCard className="h-44" />
        <SkeletonCard className="h-44" />
      </div>
    </div>
  );
}

function OpportunityStreamSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {Array.from({ length: 8 }, (_, idx) => (
        <SkeletonCard key={`opp-skeleton-${idx}`} className="h-44" />
      ))}
    </div>
  );
}

function DiscoveryScannerSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {Array.from({ length: 8 }, (_, idx) => (
          <SkeletonCard key={`scanner-skeleton-${idx}`} className="h-44" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {Array.from({ length: 6 }, (_, idx) => (
          <SkeletonCard key={`scanner-news-skeleton-${idx}`} className="h-44" />
        ))}
      </div>
    </div>
  );
}

function WatchlistSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {Array.from({ length: 8 }, (_, idx) => (
        <SkeletonCard key={`watch-skeleton-${idx}`} className="h-44" />
      ))}
    </div>
  );
}

function StrategyLearningSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {Array.from({ length: 8 }, (_, idx) => (
        <SkeletonCard key={`strategy-skeleton-${idx}`} className="h-40" />
      ))}
    </div>
  );
}

function MarketContextSection({ enabled }) {
  const { data, isLoading } = useQuery({
    queryKey: ['terminal-market-context'],
    enabled,
    queryFn: async () => {
      const [sectors, indices, summary] = await Promise.all([
        apiClient('/market/sectors').catch(() => []),
        apiClient('/market/indices').catch(() => []),
        apiClient('/radar/summary').catch(() => ({})),
      ]);

      return {
        sectors: toItems(sectors),
        indices: toItems(indices),
        summary: summary || {},
      };
    },
    staleTime: 20000,
    refetchInterval: 30000,
  });

  const trendRows = useMemo(() => {
    const map = new Map((data?.indices || []).map((row) => [normalizeSymbol(row?.symbol || row?.ticker || row?.name), row]));
    return ['SPY', 'QQQ'].map((symbol) => {
      const row = map.get(symbol) || {};
      const changePercent = toNumber(row.change_percent ?? row.changePercent ?? row.percent_change, null);
      const trend = changePercent == null ? 'Neutral' : changePercent >= 0 ? 'Bullish' : 'Bearish';
      return {
        symbol,
        price: row.price ?? row.last ?? '--',
        changePercent,
        trend,
      };
    });
  }, [data?.indices]);

  const breadth = data?.summary?.breadth || {
    advancers: data?.summary?.advancers,
    decliners: data?.summary?.decliners,
    upVolume: data?.summary?.upVolume,
    downVolume: data?.summary?.downVolume,
  };

  if (isLoading) return <MarketContextSkeleton />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {(data?.sectors || []).slice(0, 6).map((sector, idx) => (
          <SectorMomentumCard key={`${sector?.sector || sector?.name || 'sector'}-${idx}`} sector={sector} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <MarketBreadthCard data={breadth || {}} />
        <article className="rounded-xl border border-slate-800 bg-slate-950 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-100">SPY / QQQ Trend Summary</h3>
          <div className="space-y-2 text-sm text-slate-300">
            {trendRows.map((row) => (
              <div key={row.symbol} className="flex items-center justify-between rounded border border-slate-800 bg-slate-900 px-3 py-2">
                <span className="font-semibold text-slate-100">{row.symbol}</span>
                <span>Price: <span className="text-blue-400">{typeof row.price === 'number' ? row.price.toFixed(2) : row.price}</span></span>
                <span>
                  Change: <span className={row.changePercent == null ? 'text-slate-300' : row.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {row.changePercent == null ? '--' : `${row.changePercent.toFixed(2)}%`}
                  </span>
                </span>
                <span className={row.trend === 'Bullish' ? 'text-green-400' : row.trend === 'Bearish' ? 'text-red-400' : 'text-slate-300'}>{row.trend}</span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}

function BeaconOpportunitiesSection({ enabled }) {
  const { data, isLoading } = useQuery({
    queryKey: ['terminal-beacon-opportunities'],
    enabled,
    queryFn: async () => {
      const [stream, opportunities] = await Promise.all([
        apiClient('/opportunity-stream').catch(() => []),
        apiClient('/opportunities').catch(() => []),
      ]);

      const combined = [...toItems(stream), ...toItems(opportunities)];
      const merged = new Map();

      for (const item of combined) {
        const symbol = normalizeSymbol(item?.symbol || item?.ticker);
        if (!symbol) continue;
        const existing = merged.get(symbol);
        const confidence = toNumber(item?.confidence ?? item?.score ?? item?.rank_score, 0);
        const existingConfidence = toNumber(existing?.confidence ?? existing?.score ?? existing?.rank_score, -1);
        if (!existing || confidence > existingConfidence) {
          merged.set(symbol, { ...item, symbol });
        }
      }

      return [...merged.values()]
        .sort((a, b) => {
          const rankA = toNumber(a?.rank, Number.MAX_SAFE_INTEGER);
          const rankB = toNumber(b?.rank, Number.MAX_SAFE_INTEGER);
          if (rankA !== rankB) return rankA - rankB;
          const scoreA = toNumber(a?.confidence ?? a?.score ?? a?.rank_score, 0);
          const scoreB = toNumber(b?.confidence ?? b?.score ?? b?.rank_score, 0);
          return scoreB - scoreA;
        })
        .slice(0, 8);
    },
    staleTime: 20000,
    refetchInterval: 30000,
  });

  if (isLoading) return <OpportunityStreamSkeleton />;

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {(data || []).map((item, idx) => (
        <OpportunityCard key={`${item?.symbol || 'opp'}-${idx}`} item={item} />
      ))}
    </div>
  );
}

function DiscoveryScannerSection({ enabled }) {
  const { data, isLoading } = useQuery({
    queryKey: ['terminal-discovery-scanner'],
    enabled,
    queryFn: async () => {
      const [scanner, moves] = await Promise.all([
        apiClient('/scanner').catch(() => []),
        apiClient('/moves').catch(() => []),
      ]);

      const moveMap = new Map(toItems(moves).map((row) => [normalizeSymbol(row?.symbol || row?.ticker), row]));
      const rows = toItems(scanner)
        .map((row) => {
          const symbol = normalizeSymbol(row?.symbol || row?.ticker);
          const move = moveMap.get(symbol) || {};
          return {
            symbol,
            confidence: toNumber(row?.score ?? row?.confidence ?? row?.rank_score ?? row?.relative_volume ?? row?.rvol, 0),
            expected_move: row?.expected_move ?? row?.expectedMove ?? move?.expected_move ?? '--',
            catalyst_summary: row?.catalyst_summary ?? row?.strategy ?? move?.reason ?? 'High RVOL scanner candidate',
            sector_context: row?.sector ?? move?.sector ?? '--',
            setup: row?.strategy || row?.setup || 'Scanner',
            relativeVolume: toNumber(row?.relative_volume ?? row?.rvol, 0),
          };
        })
        .filter((row) => row.symbol)
        .sort((a, b) => b.relativeVolume - a.relativeVolume)
        .slice(0, 8);

      return rows;
    },
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const newsRows = useMemo(() => {
    return (data || [])
      .map((row) => ({
        symbol: row.symbol,
        confidence: row.confidence,
        expected_move: row.expected_move,
        catalyst_summary: row.catalyst_summary,
        sector_context: row.sector_context,
        headline: row.catalyst_summary,
        catalyst_type: row.setup || 'Scanner',
      }))
      .slice(0, 6);
  }, [data]);

  if (isLoading) return <DiscoveryScannerSkeleton />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {(data || []).map((signal, idx) => (
          <SignalCard key={`${signal.symbol || 'scanner'}-${idx}`} signal={signal} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {newsRows.map((item, idx) => (
          <NewsCatalystCard key={`${item.symbol || 'scanner-news'}-${idx}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function WatchlistIntelligenceSection({ enabled }) {
  const { data, isLoading } = useQuery({
    queryKey: ['terminal-watchlist-intelligence'],
    enabled,
    queryFn: async () => {
      const payload = await apiClient('/watchlist/signals').catch(() => []);
      return toItems(payload)
        .map((row) => ({
          symbol: normalizeSymbol(row?.symbol || row?.ticker),
          confidence: toNumber(row?.confidence ?? row?.score ?? row?.rank_score, 0),
          expected_move: row?.expected_move ?? row?.expectedMove ?? '--',
          catalyst_summary: row?.catalyst_summary ?? row?.catalyst ?? row?.reason ?? 'Watchlist signal',
          sector_context: row?.sector_context ?? row?.sector ?? '--',
          setup: row?.setup ?? row?.strategy ?? 'Watchlist',
        }))
        .filter((row) => row.symbol)
        .slice(0, 8);
    },
    staleTime: 15000,
    refetchInterval: 30000,
  });

  if (isLoading) return <WatchlistSkeleton />;

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {(data || []).map((signal, idx) => (
        <SignalCard key={`${signal.symbol || 'watch'}-${idx}`} signal={signal} />
      ))}
    </div>
  );
}

function StrategyLearningSection({ enabled }) {
  const { data, isLoading } = useQuery({
    queryKey: ['terminal-strategy-learning'],
    enabled,
    queryFn: async () => {
      const [performance, probabilities] = await Promise.all([
        apiClient('/strategy/performance').catch(() => []),
        apiClient('/intelligence/trade-probability').catch(() => []),
      ]);

      const perfItems = toItems(performance).map((row) => ({
        strategy: row?.strategy || row?.name || row?.setup || 'Strategy',
        win_rate: toNumber(row?.win_rate ?? row?.winRate, 0),
        edge_score: toNumber(row?.edge_score ?? row?.edge, 0),
        signals_count: toNumber(row?.signals_count ?? row?.samples, 0),
      }));

      const probItems = toItems(probabilities);
      const grouped = new Map();
      for (const row of probItems) {
        const key = String(row?.strategy || row?.setup || 'Probability Model');
        const current = grouped.get(key) || { total: 0, count: 0 };
        current.total += toNumber(row?.probability ?? row?.win_probability, 0);
        current.count += 1;
        grouped.set(key, current);
      }

      const inferred = [...grouped.entries()].map(([strategy, value]) => ({
        strategy,
        win_rate: value.count ? value.total / value.count : 0,
        edge_score: (value.count ? value.total / value.count : 0) / 100,
        signals_count: value.count,
      }));

      const merged = [...perfItems, ...inferred]
        .reduce((map, row) => {
          const key = row.strategy;
          const existing = map.get(key);
          if (!existing || toNumber(row.signals_count, 0) > toNumber(existing.signals_count, 0)) {
            map.set(key, row);
          }
          return map;
        }, new Map());

      return [...merged.values()]
        .sort((a, b) => toNumber(b.edge_score, 0) - toNumber(a.edge_score, 0))
        .slice(0, 8);
    },
    staleTime: 30000,
    refetchInterval: 45000,
  });

  if (isLoading) return <StrategyLearningSkeleton />;

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {(data || []).map((strategy, idx) => (
        <StrategyScoreCard key={`${strategy.strategy || 'strategy'}-${idx}`} strategy={strategy} />
      ))}
    </div>
  );
}

export default function OpenRangeTerminal() {
  const { showBeaconSignals, toggleBeaconSignals } = useBeaconOverlayVisibility('terminal', true);
  const market = useSectionInView();
  const beacon = useSectionInView();
  const discovery = useSectionInView();
  const watchlist = useSectionInView();
  const learning = useSectionInView();

  const { data: terminalSignalCandidates = [] } = useQuery({
    queryKey: ['terminal-beacon-status-candidates'],
    enabled: showBeaconSignals,
    queryFn: async () => {
      const [stream, opportunities, scanner, watchlistSignals] = await Promise.all([
        apiClient('/opportunity-stream').catch(() => []),
        apiClient('/opportunities').catch(() => []),
        apiClient('/scanner').catch(() => []),
        apiClient('/watchlist/signals').catch(() => []),
      ]);

      return [...new Set([
        ...toItems(stream).slice(0, 8).map((row) => normalizeSymbol(row?.symbol || row?.ticker)),
        ...toItems(opportunities).slice(0, 8).map((row) => normalizeSymbol(row?.symbol || row?.ticker)),
        ...toItems(scanner).slice(0, 8).map((row) => normalizeSymbol(row?.symbol || row?.ticker)),
        ...toItems(watchlistSignals).slice(0, 8).map((row) => normalizeSymbol(row?.symbol || row?.ticker)),
      ].filter(Boolean))];
    },
    staleTime: 30000,
    refetchInterval: 45000,
  });

  const { getSignal } = useBeaconSignalMap({
    symbols: terminalSignalCandidates,
    enabled: showBeaconSignals,
    debounceMs: 300,
  });

  const activeBeaconSymbolCount = useMemo(() => {
    if (!showBeaconSignals) return 0;
    return terminalSignalCandidates.filter((symbol) => Boolean(getSignal(symbol))).length;
  }, [showBeaconSignals, terminalSignalCandidates, getSignal]);

  return (
    <div className="space-y-4 bg-slate-950 text-slate-100">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">OpenRange Intelligence Terminal</h1>
            <p className="mt-1 text-sm text-slate-300">
              Unified command grid for market context, Beacon opportunities, discovery scanner, watchlist intelligence, and strategy learning.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleBeaconSignals}
              className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-100"
            >
              {showBeaconSignals ? 'Hide Beacon Signals' : 'Show Beacon Signals'}
            </button>
            <BeaconOverlayStatusChip isEnabled={showBeaconSignals} activeSymbols={activeBeaconSymbolCount} />
          </div>
        </div>
      </section>

      <div className="space-y-4">
        <SectionFrame title="Market Context" isVisible={market.isVisible} sectionRef={market.ref}>
          {market.isVisible ? <MarketContextSection enabled={market.isVisible} /> : <LoadingBlock message="Section will load when in view..." />}
        </SectionFrame>

        <SectionFrame title="Beacon Opportunities" isVisible={beacon.isVisible} sectionRef={beacon.ref}>
          {beacon.isVisible ? <BeaconOpportunitiesSection enabled={beacon.isVisible} /> : <LoadingBlock message="Section will load when in view..." />}
        </SectionFrame>

        <SectionFrame title="Discovery Scanner" isVisible={discovery.isVisible} sectionRef={discovery.ref}>
          {discovery.isVisible ? <DiscoveryScannerSection enabled={discovery.isVisible} /> : <LoadingBlock message="Section will load when in view..." />}
        </SectionFrame>

        <SectionFrame title="Watchlist Intelligence" isVisible={watchlist.isVisible} sectionRef={watchlist.ref}>
          {watchlist.isVisible ? <WatchlistIntelligenceSection enabled={watchlist.isVisible} /> : <LoadingBlock message="Section will load when in view..." />}
        </SectionFrame>

        <SectionFrame title="Strategy Learning" isVisible={learning.isVisible} sectionRef={learning.ref}>
          {learning.isVisible ? <StrategyLearningSection enabled={learning.isVisible} /> : <LoadingBlock message="Section will load when in view..." />}
        </SectionFrame>
      </div>
    </div>
  );
}
