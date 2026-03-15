import React, { useEffect, useMemo, useState } from 'react';
import { authFetch } from '../utils/api';
import { formatNumber, formatPercent } from '../utils/formatters';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import MarketCard from '../components/MarketCard';
import SectorMomentumCard from '../components/cards/SectorMomentumCard';
import MarketBreadthCard from '../components/cards/MarketBreadthCard';
import SignalCard from '../components/cards/SignalCard';
import OpportunityCard from '../components/cards/OpportunityCard';
import NewsCatalystCard from '../components/cards/NewsCatalystCard';

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM', '^VIX'];

export default function MarketOverviewPage() {
  const [compactMode, setCompactMode] = useState(false);
  const [quotesPayload, setQuotesPayload] = useState([]);
  const [intelData, setIntelData] = useState({
    sectors: [],
    signals: [],
    opportunities: [],
    news: [],
    breadth: {},
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [results, sectorsRes, signalsRes, opportunitiesRes, newsRes, summaryRes] = await Promise.all([
          Promise.all(
            INDEX_SYMBOLS?.map(async (symbol) => {
              const query = new URLSearchParams({ symbol, timeframe: '1D', interval: '1day' }).toString();
              const response = await authFetch(`/api/v5/chart?${query}`);
              if (!response.ok) {
                return { ticker: symbol, shortName: symbol, price: null, changePercent: null };
              }

              const data = await response.json();
              const candles = Array.isArray(data?.candles) ? data?.candles : [];
              const latest = candles[candles.length - 1];
              const previous = candles[candles.length - 2];
              const price = Number(latest?.close);
              const prevClose = Number(previous?.close);

              const changePercent = Number.isFinite(price) && Number.isFinite(prevClose) && prevClose !== 0
                ? ((price - prevClose) / prevClose) * 100
                : null;

              return {
                ticker: symbol,
                shortName: symbol,
                price: Number.isFinite(price) ? price : null,
                changePercent,
              };
            }),
          ),
          authFetch('/api/market/sector-strength').catch(() => null),
          authFetch('/api/intelligence/flow?limit=16').catch(() => null),
          authFetch('/api/opportunities?limit=16').catch(() => null),
          authFetch('/api/news/v3?limit=16&sort=score').catch(() => null),
          authFetch('/api/radar/summary').catch(() => null),
        ]);

        const [sectorsData, signalsData, opportunitiesData, newsData, summaryData] = await Promise.all([
          sectorsRes?.ok ? sectorsRes.json().catch(() => []) : [],
          signalsRes?.ok ? signalsRes.json().catch(() => ({ items: [] })) : { items: [] },
          opportunitiesRes?.ok ? opportunitiesRes.json().catch(() => ({ items: [] })) : { items: [] },
          newsRes?.ok ? newsRes.json().catch(() => ([])) : [],
          summaryRes?.ok ? summaryRes.json().catch(() => ({})) : {},
        ]);

        if (!cancelled) {
          setQuotesPayload(results);
          setIntelData({
            sectors: Array.isArray(sectorsData) ? sectorsData : (sectorsData?.items || sectorsData?.rows || []),
            signals: signalsData?.items || signalsData?.rows || signalsData?.signals || (Array.isArray(signalsData) ? signalsData : []),
            opportunities: opportunitiesData?.items || opportunitiesData?.rows || (Array.isArray(opportunitiesData) ? opportunitiesData : []),
            news: Array.isArray(newsData) ? newsData : (newsData?.items || []),
            breadth: summaryData?.breadth || summaryData || {},
          });
        }
      } catch (_error) {
        if (!cancelled) {
          setQuotesPayload(INDEX_SYMBOLS?.map((ticker) => ({ ticker, shortName: ticker, price: null, changePercent: null })));
          setIntelData({ sectors: [], signals: [], opportunities: [], news: [], breadth: {} });
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

  const quotes = useMemo(() => {
    const map = {};
    quotesPayload.forEach((q) => {
      map[q.ticker] = q;
    });
    return INDEX_SYMBOLS?.map((sym) => map[sym] || { ticker: sym, shortName: sym, price: null, changePercent: null });
  }, [quotesPayload]);

  const compactRows = useMemo(() => {
    const toRow = (item) => ({
      symbol: String(item?.symbol || item?.ticker || '').toUpperCase() || '--',
      confidence: Number(item?.confidence ?? item?.score ?? item?.rank_score ?? item?.news_score ?? 0).toFixed(1),
      expectedMove: item?.expected_move ?? item?.expectedMove ?? item?.move_percent ?? '--',
      catalyst: item?.catalyst_summary ?? item?.catalyst ?? item?.reason ?? item?.headline ?? '--',
      sector: item?.sector_context ?? item?.sector ?? item?.industry ?? '--',
    });

    return [
      ...(intelData?.opportunities || []).slice(0, 6).map(toRow),
      ...(intelData?.signals || []).slice(0, 6).map(toRow),
      ...(intelData?.news || []).slice(0, 6).map(toRow),
    ];
  }, [intelData]);

  return (
    <PageContainer className="space-y-3">
      <PageHeader
        title="Global Market Overview"
        subtitle="Key indices, volatility gauge, and live SPY chart."
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

      <div className="panel">
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          {quotes?.map(q => (
            <div key={q.ticker} className="stat-card" style={{ padding: 12 }}>
              <div className="stat-label" style={{ marginBottom: 4 }}>{q.shortName || q.ticker}</div>
              <div className="stat-value">{q.price != null ? formatNumber(q.price) : '--'}</div>
              <div className={q.changePercent >= 0 ? 'text-positive' : 'text-negative'}>
                {q.changePercent != null ? formatPercent(q.changePercent) : '--'}
              </div>
            </div>
          ))}
          {loading && <div style={{ color: 'var(--text-muted)' }}>Loading index quotes…</div>}
        </div>
      </div>

      <div className="panel grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <h3 className="mt-0">SPY Market Card</h3>
          <MarketCard symbol="SPY" />
        </div>
        <div>
          <h3 className="mt-0">QQQ Market Card</h3>
          <MarketCard symbol="QQQ" />
        </div>
      </div>

      {!compactMode ? (
        <>
          <section className="grid gap-4 xl:grid-cols-2">
            {(intelData?.sectors || []).slice(0, 6).map((sector, idx) => (
              <SectorMomentumCard key={`${sector?.sector || sector?.name || 'sector'}-${idx}`} sector={sector} />
            ))}
            <MarketBreadthCard data={intelData?.breadth || {}} />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            {(intelData?.opportunities || []).slice(0, 9).map((item, idx) => (
              <OpportunityCard key={`${item?.symbol || 'opp'}-${idx}`} item={item} />
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            {(intelData?.signals || []).slice(0, 8).map((signal, idx) => (
              <SignalCard key={`${signal?.symbol || 'signal'}-${idx}`} signal={signal} />
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            {(intelData?.news || []).slice(0, 8).map((item, idx) => (
              <NewsCatalystCard key={`${item?.id || item?.symbol || 'news'}-${idx}`} item={item} />
            ))}
          </section>
        </>
      ) : (
        <section className="panel overflow-x-auto">
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
              {compactRows.length ? compactRows.map((row, idx) => (
                <tr key={`${row.symbol}-${idx}`}>
                  <td>{row.symbol}</td>
                  <td style={{ textAlign: 'right' }}>{row.confidence}</td>
                  <td>{row.expectedMove}</td>
                  <td>{row.catalyst}</td>
                  <td>{row.sector}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="muted">No compact intelligence rows available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {loading && <div style={{ color: 'var(--text-muted)' }}>Loading intelligence cards…</div>}
    </PageContainer>
  );
}
