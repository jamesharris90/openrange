import React, { useState } from 'react';
import ResearchPanel from '../components/watchlist/ResearchPanel';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import { FilterGroup, InputField } from '../components/shared/filters/FilterPrimitives';
import Card from '../components/shared/Card';

const QUICK_TICKERS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'AMZN', 'TSLA', 'META'];

export default function ResearchPage() {
  const [symbol, setSymbol] = useState('SPY');
  const [input, setInput] = useState('SPY');

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
        <FilterGroup className="mt-3" title="Research Filters">
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
            <InputField className="w-full sm:w-auto sm:min-w-[220px]" label="Ticker" placeholder="Enter ticker" value={input} onChange={e => setInput(e.target.value)} />
            <button className="btn-primary" type="submit">Load</button>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TICKERS.map(t => (
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
