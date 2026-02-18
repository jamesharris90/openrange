import React, { useState } from 'react';
import TradingViewChart from '../components/shared/TradingViewChart';

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
    <div className="page-container">
      <div className="panel" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Open Market Board</h2>
        <p className="muted" style={{ marginTop: 4 }}>Multi-panel layout for live charting. Drag in watchlist symbols or type new tickers.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 12 }}>
          {symbols.map((s, i) => (
            <input key={i} className="input-field" value={s} onChange={e => updateSymbol(i, e.target.value)} aria-label={`Chart ${i + 1}`} />
          ))}
        </div>
      </div>

      <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {symbols.map((s, i) => (
          <div key={`${s}-${i}`}>
            <div className="muted" style={{ marginBottom: 6 }}>{s || `Chart ${i + 1}`}</div>
            {s ? <TradingViewChart symbol={s} height={320} interval="15" range="5D" hideSideToolbar /> : <div className="muted">Enter a symbol to load a chart.</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
