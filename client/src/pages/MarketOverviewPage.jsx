import React, { useEffect, useMemo, useState } from 'react';
import { authFetch } from '../utils/api';
import { formatNumber, formatPercent } from '../utils/formatters';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import MarketCard from '../components/MarketCard';

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM', '^VIX'];

export default function MarketOverviewPage() {
  const [quotesPayload, setQuotesPayload] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const results = await Promise.all(
          INDEX_SYMBOLS.map(async (symbol) => {
            const query = new URLSearchParams({ symbol, timeframe: '1D', interval: '1day' }).toString();
            const response = await authFetch(`/api/v5/chart?${query}`);
            if (!response.ok) {
              return { ticker: symbol, shortName: symbol, price: null, changePercent: null };
            }

            const data = await response.json();
            const candles = Array.isArray(data?.candles) ? data.candles : [];
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
        );

        if (!cancelled) {
          setQuotesPayload(results);
        }
      } catch (_error) {
        if (!cancelled) {
          setQuotesPayload(INDEX_SYMBOLS.map((ticker) => ({ ticker, shortName: ticker, price: null, changePercent: null })));
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
    return INDEX_SYMBOLS.map((sym) => map[sym] || { ticker: sym, shortName: sym, price: null, changePercent: null });
  }, [quotesPayload]);

  return (
    <PageContainer className="space-y-3">
      <PageHeader
        title="Global Market Overview"
        subtitle="Key indices, volatility gauge, and live SPY chart."
      />

      <div className="panel">
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          {quotes.map(q => (
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
    </PageContainer>
  );
}
