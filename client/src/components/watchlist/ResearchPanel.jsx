import { useState, useEffect } from 'react';
import TradingViewChart from '../shared/TradingViewChart';
import TradingViewProfile from '../shared/TradingViewProfile';
import { formatCurrency, formatPercent, formatMarketCap, getTimeAgo } from '../../utils/formatters';
import { X, ExternalLink } from 'lucide-react';

export default function ResearchPanel({ symbol, onClose }) {
  const [quote, setQuote] = useState(null);
  const [news, setNews] = useState([]);

  useEffect(() => {
    if (!symbol) return;
    // Fetch quote
    fetch(`/api/yahoo/quote-batch?symbols=${symbol}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.quotes?.[0] && setQuote(d.quotes[0]))
      .catch(() => {});

    // Fetch news (last 7 days)
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    fetch(`/api/finnhub/news/symbol?symbol=${symbol}&from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setNews(Array.isArray(d) ? d.slice(0, 10) : []))
      .catch(() => {});
  }, [symbol]);

  if (!symbol) return null;

  return (
    <div className="research-panel">
      <div className="research-panel__header">
        <h2>{symbol}</h2>
        {quote && <span className="research-panel__name">{quote.shortName}</span>}
        <button className="research-panel__close" onClick={onClose}><X size={20} /></button>
      </div>

      {quote && (
        <div className="research-panel__stats">
          <div className="stat-card">
            <div className="stat-label">Price</div>
            <div className="stat-value">{formatCurrency(quote.price)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Change</div>
            <div className="stat-value" style={{ color: quote.changePercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
              {formatPercent(quote.changePercent)}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Market Cap</div>
            <div className="stat-value">{formatMarketCap(quote.marketCap)}</div>
          </div>
        </div>
      )}

      <div className="research-panel__charts">
        <div className="research-panel__chart-col">
          <div className="research-panel__chart-label">Daily</div>
          <TradingViewChart symbol={symbol} height={380} interval="D" range="3M" hideSideToolbar />
        </div>
        <div className="research-panel__chart-col">
          <div className="research-panel__chart-label">15 Min</div>
          <TradingViewChart symbol={symbol} height={380} interval="15" range="5D" hideSideToolbar />
        </div>
      </div>

      <div className="research-panel__widgets">
        <TradingViewProfile symbol={symbol} height={250} />
      </div>

      {news.length > 0 && (
        <div className="research-panel__news">
          <h3>Recent News</h3>
          {news.map((item, i) => (
            <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="news-item">
              <div className="news-item__headline">{item.headline} <ExternalLink size={12} /></div>
              <div className="news-item__meta">
                <span>{item.source}</span>
                <span>{getTimeAgo(item.datetime * 1000)}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
