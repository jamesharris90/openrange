import React, { useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import ResearchPanel from '../components/watchlist/ResearchPanel';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import { FilterGroup, InputField } from '../components/shared/filters/FilterPrimitives';
import Card from '../components/shared/Card';

const QUICK_TICKERS = ['SPY', 'QQQ', 'AMD', 'AMZN', 'META'];

export default function ResearchPage() {
  const { symbol: routeSymbol } = useParams();
  const location = useLocation();

  const initialSymbol = useMemo(() => {
    const fromRoute = String(routeSymbol || '').trim().toUpperCase();
    const fromState = String(location?.state?.earningsContext?.symbol || '').trim().toUpperCase();
    return fromRoute || fromState || 'SPY';
  }, [routeSymbol, location?.state]);

  const [symbol, setSymbol] = useState(initialSymbol);
  const [input, setInput] = useState(initialSymbol);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) setSymbol(input.trim().toUpperCase());
  };

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Research & Analysis"
          subtitle="Symbol-level fundamentals, charts, and recent news powered by TradingView and Finnhub."
        />
        {location?.state?.source === 'earnings' ? (
          <div className="mt-2 rounded-md border border-cyan-600/40 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
            Opened from earnings scanner context.
          </div>
        ) : null}
        <FilterGroup className="mt-3" title="Research Filters">
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
            <InputField className="w-full sm:w-auto sm:min-w-[220px]" label="Ticker" placeholder="Enter ticker" value={input} onChange={e => setInput(e.target.value)} />
            <button className="btn-primary" type="submit">Load</button>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TICKERS?.map(t => (
                <button key={t} type="button" className={`pill-btn${symbol === t ? ' pill-btn--active' : ''}`} onClick={() => { setSymbol(t); setInput(t); }}>
                  {t}
                </button>
              ))}
            </div>
          </form>
        </FilterGroup>
      </Card>

      <ResearchPanel symbol={symbol} onClose={() => {}} />
    </PageContainer>
  );
}
