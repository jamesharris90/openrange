import { useState, useEffect } from 'react';
import TradingViewChart from '../shared/TradingViewChart';
import TradingViewProfile from '../shared/TradingViewProfile';
import { formatCurrency, formatPercent, formatMarketCap, getTimeAgo } from '../../utils/formatters';
import { X, ExternalLink } from 'lucide-react';
import { authFetch } from '../../utils/api';

export default function ResearchPanel({ symbol, onClose }) {
  const [quote, setQuote] = useState(null);
  const [news, setNews] = useState([]);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;

    async function load() {
      try {
        const chartQuery = new URLSearchParams({ symbol, timeframe: '1D', interval: '1day' }).toString();
        const [chartRes, newsRes] = await Promise.all([
          authFetch(`/api/v5/chart?${chartQuery}`),
          authFetch(`/api/v5/news?symbol=${encodeURIComponent(symbol)}&limit=10`),
        ]);

        const chartData = chartRes.ok ? await chartRes.json() : null;
        const newsData = newsRes.ok ? await newsRes.json() : [];

        if (!cancelled) {
          const candles = Array.isArray(chartData?.candles) ? chartData.candles : [];
          const latest = candles[candles.length - 1];
          const previous = candles[candles.length - 2];
          const latestClose = Number(latest?.close);
          const previousClose = Number(previous?.close);
          const changePercent = Number.isFinite(latestClose) && Number.isFinite(previousClose) && previousClose !== 0
            ? ((latestClose - previousClose) / previousClose) * 100
            : null;

          setQuote({
            shortName: symbol,
            price: Number.isFinite(latestClose) ? latestClose : null,
            changePercent,
            marketCap: null,
          });

          setNews(
            (Array.isArray(newsData) ? newsData : []).slice(0, 10).map((item) => ({
              url: item?.url,
              headline: item?.headline || item?.title || '',
              source: item?.source || 'News',
              datetime: item?.published_at ? new Date(item.published_at).getTime() : Date.now(),
            })),
          );
        }
      } catch (_error) {
        if (!cancelled) {
          setQuote(null);
          setNews([]);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (!symbol) return null;

  return (
    <div className="research-panel or-card">
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
