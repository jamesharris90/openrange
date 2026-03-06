import { useEffect, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import { apiJSON } from '../config/api';
import { useSymbol } from '../context/SymbolContext';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import MarketContextCards from '../components/premarket/MarketContextCards';
import RadarTickerTape from '../components/radar/RadarTickerTape';
import MarketNarrativeCard from '../components/radar/MarketNarrativeCard';
import MomentumLeaders from '../components/radar/MomentumLeaders';
import StrategySignalsBoard from '../components/radar/StrategySignalsBoard';
import RadarFilters from '../components/radar/RadarFilters';
import SectorDeepDive from '../components/radar/SectorDeepDive';
import RadarStockDeepDive from '../components/radar/RadarStockDeepDive';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyFilters(rows, filters, scoreKey = 'score') {
  const minCap = toNumber(filters.minMarketCapB, 0) * 1_000_000_000;
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const score = toNumber(row?.[scoreKey] ?? row?.strategy_score, 0);
    const gap = Math.abs(toNumber(row?.gap_percent ?? row?.gap, 0));
    const rvol = toNumber(row?.relative_volume ?? row?.rvol, 0);
    const cap = toNumber(row?.market_cap, 0);
    return score >= toNumber(filters.minScore, 0)
      && gap >= toNumber(filters.minGap, 0)
      && rvol >= toNumber(filters.minRvol, 0)
      && cap >= minCap;
  });
}

export default function OpenMarketRadar() {
  const { selectedSymbol, setSelectedSymbol } = useSymbol();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [activeSector, setActiveSector] = useState('');
  const [filters, setFilters] = useState({
    minScore: '0',
    minGap: '0',
    minRvol: '0',
    minMarketCapB: '0',
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const payload = await apiJSON('/api/radar/summary');
        if (!cancelled) setSummary(payload);
      } catch (loadError) {
        if (!cancelled) {
          setSummary(null);
          setError(loadError.message || 'Failed to load radar summary');
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

  const indexCards = useMemo(() => Array.isArray(summary?.index_cards) ? summary.index_cards : [], [summary]);
  const momentumLeaders = useMemo(() => applyFilters(summary?.momentum_leaders, filters, 'strategy_score'), [summary, filters]);
  const strategySignals = useMemo(() => applyFilters(summary?.strategy_signals, filters, 'score'), [summary, filters]);
  const volumeSurges = useMemo(() => applyFilters(summary?.volume_surges, filters, 'score'), [summary, filters]);
  const catalystAlerts = useMemo(() => Array.isArray(summary?.catalyst_alerts) ? summary.catalyst_alerts.slice(0, 8) : [], [summary]);
  const opportunities = useMemo(() => applyFilters(summary?.opportunity_stream, filters, 'score').slice(0, 10), [summary, filters]);
  const sectors = useMemo(() => Array.isArray(summary?.sector_movers) ? summary.sector_movers : [], [summary]);

  const tapeRows = useMemo(() => {
    const source = opportunities.length ? opportunities : momentumLeaders;
    return source.slice(0, 20);
  }, [opportunities, momentumLeaders]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Open Market Radar"
          subtitle="Real-time intelligence board: market context, catalysts, stocks that matter, and executable trade plans."
        />
      </Card>

      <Card>
        <RadarFilters filters={filters} onChange={setFilters} />
      </Card>

      {loading ? (
        <Card>
          <LoadingSpinner message="Loading radar intelligence..." />
        </Card>
      ) : null}

      {!loading && error ? (
        <Card>
          <div style={{ color: 'var(--accent-red)' }}>{error}</div>
        </Card>
      ) : null}

      {!loading && !error ? (
        <>
          <RadarTickerTape rows={tapeRows} onSelectSector={setActiveSector} />

          <Card>
            <h3 className="m-0 mb-3">Index Cards</h3>
            <MarketContextCards
              cards={indexCards}
              targets={['SPY', 'QQQ', 'IWM', 'VIX', 'DXY', 'US10Y']}
              selectedSymbol={selectedSymbol}
              onSelectSymbol={(symbol) => {
                setActiveSector('');
                setSelectedSymbol(String(symbol || '').toUpperCase());
              }}
            />
          </Card>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,68%)_minmax(0,32%)]">
            <div className="space-y-3">
              <MarketNarrativeCard narrative={summary?.market_narrative} />

              <MomentumLeaders
                rows={momentumLeaders}
                onSelectSymbol={(symbol) => {
                  setActiveSector('');
                  setSelectedSymbol(symbol);
                }}
              />

              <StrategySignalsBoard
                rows={strategySignals}
                onSelectSymbol={(symbol) => {
                  setActiveSector('');
                  setSelectedSymbol(symbol);
                }}
              />

              <Card>
                <h3 className="m-0 mb-3">Volume Surges</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {volumeSurges.slice(0, 12).map((row) => {
                    const symbol = String(row?.symbol || '').toUpperCase();
                    const cp = toNumber(row?.change_percent, 0);
                    return (
                      <button
                        key={symbol}
                        type="button"
                        onClick={() => {
                          setActiveSector('');
                          setSelectedSymbol(symbol);
                        }}
                        className="rounded border border-[var(--border-default)] p-2 text-left"
                        style={{ background: 'var(--bg-elevated)' }}
                      >
                        <div className="flex items-center justify-between">
                          <strong>{symbol}</strong>
                          <span style={{ color: cp >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{cp.toFixed(2)}%</span>
                        </div>
                        <div className="text-xs muted">RVol {toNumber(row?.relative_volume, 0).toFixed(2)}x</div>
                      </button>
                    );
                  })}
                  {!volumeSurges.length ? <div className="muted">No volume surge rows.</div> : null}
                </div>
              </Card>

              <Card>
                <h3 className="m-0 mb-3">Catalyst Alerts</h3>
                <div className="space-y-2">
                  {catalystAlerts.map((row, index) => {
                    const symbol = String(row?.symbol || '').toUpperCase();
                    return (
                      <button
                        key={`${symbol}-${index}`}
                        type="button"
                        onClick={() => {
                          setActiveSector('');
                          if (symbol) setSelectedSymbol(symbol);
                        }}
                        className="w-full rounded border border-[var(--border-default)] p-2 text-left"
                        style={{ background: 'var(--bg-elevated)' }}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <strong>{symbol || row?.catalyst_type || 'Catalyst'}</strong>
                          <span className="muted">{row?.sentiment || 'neutral'}</span>
                        </div>
                        <div className="text-sm">{row?.headline || '--'}</div>
                      </button>
                    );
                  })}
                  {!catalystAlerts.length ? <div className="muted">No catalyst alerts.</div> : null}
                </div>
              </Card>
            </div>

            <div className="space-y-3">
              {activeSector ? (
                <SectorDeepDive
                  sector={activeSector}
                  sectors={sectors}
                  catalysts={catalystAlerts}
                  onSelectSymbol={(symbol) => {
                    setActiveSector('');
                    setSelectedSymbol(symbol);
                  }}
                />
              ) : (
                <RadarStockDeepDive symbol={selectedSymbol} />
              )}

              <Card>
                <h3 className="m-0 mb-3">Opportunity Stream</h3>
                <div className="space-y-2">
                  {opportunities.map((row, index) => {
                    const symbol = String(row?.symbol || '').toUpperCase();
                    return (
                      <button
                        key={`${symbol}-${index}`}
                        type="button"
                        onClick={() => {
                          setActiveSector('');
                          setSelectedSymbol(symbol);
                        }}
                        className="w-full rounded border border-[var(--border-default)] p-2 text-left"
                        style={{ background: 'var(--bg-elevated)' }}
                      >
                        <div className="flex items-center justify-between text-sm">
                          <strong>{symbol}</strong>
                          <span>Score {toNumber(row?.score, 0).toFixed(1)}</span>
                        </div>
                        <div className="text-xs muted">{row?.strategy || '--'} · Gap {toNumber(row?.gap, 0).toFixed(2)}%</div>
                      </button>
                    );
                  })}
                  {!opportunities.length ? <div className="muted">No opportunities after current filters.</div> : null}
                </div>
              </Card>

              <Card>
                <h3 className="m-0 mb-3">Sector Movers</h3>
                <div className="space-y-2">
                  {sectors.slice(0, 8).map((row) => {
                    const sector = String(row?.sector || 'Unknown');
                    const move = toNumber(row?.price_change || row?.avg_change_percent, 0);
                    return (
                      <button
                        key={sector}
                        type="button"
                        onClick={() => setActiveSector(sector)}
                        className="w-full rounded border border-[var(--border-default)] p-2 text-left"
                        style={{ background: 'var(--bg-elevated)' }}
                      >
                        <div className="flex items-center justify-between">
                          <strong>{sector}</strong>
                          <span style={{ color: move > 0 ? 'var(--accent-green)' : move < 0 ? 'var(--accent-red)' : 'var(--accent-amber)' }}>{move.toFixed(2)}%</span>
                        </div>
                      </button>
                    );
                  })}
                  {!sectors.length ? <div className="muted">No sector data.</div> : null}
                </div>
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </PageContainer>
  );
}
