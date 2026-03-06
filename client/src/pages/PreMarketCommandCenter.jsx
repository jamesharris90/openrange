import { useEffect, useMemo, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';
import { useSymbol } from '../context/SymbolContext';
import MarketContextCards from '../components/premarket/MarketContextCards';
import MarketRegimeCard from '../components/premarket/MarketRegimeCard';
import GapLeaderCards from '../components/premarket/GapLeaderCards';
import CatalystCards from '../components/premarket/CatalystCards';
import StrategySetupCards from '../components/premarket/StrategySetupCards';
import PreMarketDeepDive from '../components/premarket/PreMarketDeepDive';
import { formatPercent, toNumber } from '../components/premarket/utils';

function extractRows(payload, key) {
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export default function PreMarketCommandCenter() {
  const { selectedSymbol, setSelectedSymbol } = useSymbol();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setLoading(true);
      setError('');
      try {
        const payload = await apiJSON('/api/premarket/summary');
        if (!cancelled) setSummary(payload);
      } catch (loadError) {
        if (!cancelled) {
          setSummary(null);
          setError(loadError.message || 'Failed to load pre-market summary');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  const indexCards = useMemo(() => extractRows(summary, 'index_cards'), [summary]);
  const gapLeaders = useMemo(() => extractRows(summary, 'gap_leaders'), [summary]);
  const topSetups = useMemo(() => extractRows(summary, 'top_setups'), [summary]);
  const catalysts = useMemo(() => extractRows(summary, 'catalysts'), [summary]);
  const earnings = useMemo(() => extractRows(summary, 'earnings').slice(0, 8), [summary]);
  const volumeSurges = useMemo(() => extractRows(summary, 'volume_surges').slice(0, 8), [summary]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Pre-Market Command Center"
          subtitle="Decision dashboard: market context, stocks that matter, and trade plans in one view."
          actions={(
            <button className="or-button or-button-secondary" type="button" onClick={() => window.location.reload()}>
              Refresh
            </button>
          )}
        />
      </Card>

      {loading ? (
        <Card>
          <LoadingSpinner message="Loading pre-market intelligence..." />
        </Card>
      ) : null}

      {!loading && error ? (
        <Card>
          <div style={{ color: 'var(--accent-red)' }}>{error}</div>
        </Card>
      ) : null}

      {!loading && !error ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,65%)_minmax(0,35%)]">
          <div className="space-y-3">
            <Card>
              <h3 className="m-0 mb-3">Market Context</h3>
              <MarketContextCards
                cards={indexCards}
                selectedSymbol={selectedSymbol}
                onSelectSymbol={(symbol) => setSelectedSymbol(String(symbol || '').toUpperCase())}
              />
            </Card>

            <MarketRegimeCard marketContext={summary?.market_context} />

            <Card>
              <h3 className="m-0 mb-3">Gap Leaders</h3>
              <GapLeaderCards
                leaders={gapLeaders}
                selectedSymbol={selectedSymbol}
                onSelectSymbol={(symbol) => setSelectedSymbol(String(symbol || '').toUpperCase())}
              />
            </Card>

            <Card>
              <h3 className="m-0 mb-3">Catalyst Leaders</h3>
              <CatalystCards
                catalysts={catalysts}
                onSelectSymbol={(symbol) => setSelectedSymbol(String(symbol || '').toUpperCase())}
              />
            </Card>

            <Card>
              <h3 className="m-0 mb-3">Top Strategy Setups</h3>
              <StrategySetupCards
                setups={topSetups}
                selectedSymbol={selectedSymbol}
                onSelectSymbol={(symbol) => setSelectedSymbol(String(symbol || '').toUpperCase())}
              />
            </Card>

            <Card>
              <h3 className="m-0 mb-3">Volume Surges</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {volumeSurges.length === 0 ? <div className="muted">No high-volume surges.</div> : null}
                {volumeSurges.map((row) => {
                  const symbol = String(row?.symbol || '').toUpperCase();
                  return (
                    <button
                      key={symbol}
                      type="button"
                      className="text-left rounded p-2"
                      style={{ border: '1px solid var(--border-default)', background: 'var(--bg-elevated)' }}
                      onClick={() => setSelectedSymbol(symbol)}
                    >
                      <div className="flex items-center justify-between">
                        <strong>{symbol}</strong>
                        <span>{toNumber(row?.relative_volume, 0).toFixed(2)}x</span>
                      </div>
                      <div className="text-xs muted">Gap {formatPercent(row?.gap_percent)}</div>
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card>
              <h3 className="m-0 mb-3">Earnings</h3>
              <div className="space-y-2">
                {earnings.length === 0 ? <div className="muted">No earnings entries for today.</div> : null}
                {earnings.map((row, index) => {
                  const symbol = String(row?.symbol || '').toUpperCase();
                  return (
                    <button
                      key={`${symbol}-${index}`}
                      type="button"
                      className="w-full text-left rounded p-2"
                      style={{ border: '1px solid var(--border-default)', background: 'var(--bg-elevated)' }}
                      onClick={() => setSelectedSymbol(symbol)}
                    >
                      <div className="flex items-center justify-between">
                        <strong>{symbol || '--'}</strong>
                        <span className="text-xs muted">{row?.earnings_date || '--'}</span>
                      </div>
                      <div className="text-sm muted">{row?.company || 'Company data unavailable'}</div>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="space-y-3">
            <PreMarketDeepDive symbol={selectedSymbol} />
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
