import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';
import SectorMomentumCard from '../components/cards/SectorMomentumCard';
import MarketBreadthCard from '../components/cards/MarketBreadthCard';
import SignalCard from '../components/cards/SignalCard';
import OpportunityCard from '../components/cards/OpportunityCard';
import NewsCatalystCard from '../components/cards/NewsCatalystCard';

function fmt(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

export default function IntelligenceEngine() {
  const [compactMode, setCompactMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ sectors: [], opportunities: [], earnings: { today: [], week: [] }, news: [] });

  const compactRows = [
    ...(summary?.opportunities || []).slice(0, 8),
    ...(summary?.opportunities || []).slice(0, 8).map((item) => ({
      ...item,
      confidence: item?.confidence ?? item?.score ?? item?.rank_score,
      catalyst_summary: item?.catalyst_summary ?? item?.strategy ?? item?.catalyst,
    })),
    ...(summary?.news || []).slice(0, 8),
  ];

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const payload = await apiJSON('/api/intelligence/summary');
        if (!cancelled) {
          setSummary(payload?.summary || { sectors: [], opportunities: [], earnings: { today: [], week: [] }, news: [] });
        }
      } catch {
        if (!cancelled) {
          setSummary({ sectors: [], opportunities: [], earnings: { today: [], week: [] }, news: [] });
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

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Intelligence Engine"
          subtitle="Unified overview of sectors, opportunities, earnings, and news."
          actions={(
            <button
              type="button"
              onClick={() => setCompactMode((current) => !current)}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
            >
              {compactMode ? 'Card Mode' : 'Compact Table Mode'}
            </button>
          )}
        />
      </Card>

      {loading ? (
        <Card><LoadingSpinner message="Loading intelligence summary…" /></Card>
      ) : (
        compactMode ? (
          <Card className="overflow-x-auto">
            <table className="data-table data-table--compact min-w-full">
              <thead>
                <tr>
                  <th>symbol</th>
                  <th style={{ textAlign: 'right' }}>confidence</th>
                  <th>expected move</th>
                  <th>catalyst</th>
                  <th>sector</th>
                </tr>
              </thead>
              <tbody>
                {compactRows.length ? (
                  compactRows.map((item, idx) => (
                    <tr key={`${item?.symbol || item?.url || 'intel'}-${idx}`}>
                      <td>{String(item?.symbol || '').toUpperCase() || 'MARKET'}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(item?.confidence ?? item?.score ?? item?.news_score ?? 0, 1)}</td>
                      <td>{item?.expected_move ?? item?.expectedMove ?? item?.move_percent ?? '--'}</td>
                      <td>{item?.catalyst_summary ?? item?.catalyst ?? item?.headline ?? '--'}</td>
                      <td>{item?.sector_context ?? item?.sector ?? item?.industry ?? '--'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="muted">No compact intelligence rows available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        ) : (
          <>
            <section className="grid gap-4 xl:grid-cols-2">
              {(summary?.sectors || []).slice(0, 6).map((sector, idx) => (
                <SectorMomentumCard key={`${sector?.sector || sector?.name || 'sector'}-${idx}`} sector={sector} />
              ))}
              <MarketBreadthCard
                data={{
                  advancers: (summary?.sectors || []).filter((row) => Number(row?.avg_change) >= 0).length,
                  decliners: (summary?.sectors || []).filter((row) => Number(row?.avg_change) < 0).length,
                  upVolume: '--',
                  downVolume: '--',
                }}
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              {(summary?.opportunities || []).slice(0, 8).map((signal, idx) => (
                <OpportunityCard key={`${signal?.symbol || 'opp'}-${idx}`} item={signal} />
              ))}
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              {(summary?.opportunities || []).slice(0, 9).map((item, idx) => (
                <SignalCard key={`${item?.symbol || 'signal'}-${idx}`} signal={item} />
              ))}
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              {(summary?.news || []).slice(0, 8).map((item, idx) => (
                <NewsCatalystCard key={`${item?.url || item?.symbol || 'news'}-${idx}`} item={item} />
              ))}
            </section>
          </>
        )
      )}
    </PageContainer>
  );
}
