import React, { useState } from 'react';
import TradingViewChart from '../components/shared/TradingViewChart';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import { FilterGroup, InputField } from '../components/shared/filters/FilterPrimitives';
import Card from '../components/shared/Card';

export default function OpenMarketPage() {
  const [symbols, setSymbols] = useState(['SPY', 'QQQ', 'AAPL', 'MSFT']);

  const updateSymbol = (idx, value) => {
    setSymbols(prev => {
      const next = [...prev];
      next[idx] = value.toUpperCase();
      return next;
    });
  };

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Open Market Board"
          subtitle="Multi-panel layout for live charting. Drag in watchlist symbols or type new tickers."
        />
        <FilterGroup className="mt-3" title="Symbol Inputs">
          <div className="layout-grid-cards">
            {symbols.map((s, i) => (
              <InputField
                key={i}
                label={`Chart ${i + 1}`}
                value={s}
                onChange={e => updateSymbol(i, e.target.value)}
                aria-label={`Chart ${i + 1}`}
              />
            ))}
          </div>
        </FilterGroup>
      </Card>

      <Card className="grid gap-3 md:grid-cols-2">
        {symbols.map((s, i) => (
          <div key={`${s}-${i}`}>
            <div className="muted" style={{ marginBottom: 6 }}>{s || `Chart ${i + 1}`}</div>
            {s ? <TradingViewChart symbol={s} height={320} interval="15" range="5D" hideSideToolbar /> : <div className="muted">Enter a symbol to load a chart.</div>}
          </div>
        ))}
      </Card>
    </PageContainer>
  );
}
