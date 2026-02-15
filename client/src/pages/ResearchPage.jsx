import React, { useState } from 'react';
import ResearchPanel from '../components/watchlist/ResearchPanel';

const QUICK_TICKERS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'AMZN', 'TSLA', 'META'];

export default function ResearchPage() {
  const [symbol, setSymbol] = useState('SPY');
  const [input, setInput] = useState('SPY');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) setSymbol(input.trim().toUpperCase());
  };

  return (
    <div className="page-container">
      <div className="panel" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Research & Analysis</h2>
        <p className="muted" style={{ marginTop: 4 }}>Symbol-level fundamentals, charts, and recent news powered by TradingView and Finnhub.</p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input className="input-field" placeholder="Enter ticker" value={input} onChange={e => setInput(e.target.value)} style={{ maxWidth: 220 }} />
          <button className="btn-primary" type="submit">Load</button>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {QUICK_TICKERS.map(t => (
              <button key={t} type="button" className={`pill-btn${symbol === t ? ' pill-btn--active' : ''}`} onClick={() => { setSymbol(t); setInput(t); }}>
                {t}
              </button>
            ))}
          </div>
        </form>
      </div>

      <ResearchPanel symbol={symbol} onClose={() => {}} />
    </div>
  );
}
