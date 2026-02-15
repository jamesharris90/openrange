import React, { useMemo } from 'react';
import TradingViewChart from '../components/shared/TradingViewChart';
import useApi from '../hooks/useApi';
import { formatNumber, formatPercent } from '../utils/formatters';

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM', '^VIX'];

export default function MarketOverviewPage() {
  const { data, loading } = useApi(`/api/yahoo/quote-batch?symbols=${INDEX_SYMBOLS.join(',')}`);
  const quotes = useMemo(() => {
    const map = {};
    data?.quotes?.forEach(q => { map[q.ticker] = q; });
    return INDEX_SYMBOLS.map(sym => map[sym] || { ticker: sym });
  }, [data]);

  return (
    <div className="page-container">
      <div className="panel" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Global Market Overview</h2>
        <p className="muted" style={{ marginTop: 4 }}>Key indices, volatility gauge, and live SPY chart.</p>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
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

      <div className="panel" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>SPY Live Chart</h3>
          <TradingViewChart symbol="SPY" height={420} range="1D" interval="5" hideSideToolbar />
        </div>
        <div>
          <h3 style={{ marginTop: 0 }}>QQQ Trend</h3>
          <TradingViewChart symbol="QQQ" height={420} range="5D" interval="60" hideSideToolbar />
        </div>
      </div>
    </div>
  );
}
