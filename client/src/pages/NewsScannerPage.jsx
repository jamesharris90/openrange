import { useEffect, useMemo, useState, useCallback } from 'react';
import { RefreshCcw, SlidersHorizontal, X, ExternalLink, Star, Download } from 'lucide-react';
import useWatchlist from '../hooks/useWatchlist';
import TabbedFilterPanel from '../components/shared/TabbedFilterPanel';
import {
  parseTickers,
  detectCatalysts,
  parseFinvizDate,
  getTimeAgo,
  computeStockScore,
  buildBadges,
  toCsvValue,
} from '../features/news/NewsScannerLogic';
import {
  buildFinvizFilterString,
  buildFilterDefaults,
} from '../features/news/FilterConfigs';
import { formatNumber, formatPercent } from '../utils/formatters';

const FRESHNESS_MAP = {
  '15m': 0.25,
  '1h': 1,
  'breaking': 1,
  '2h': 2,
  '6h': 6,
  '12h': 12,
  '24h': 24,
  '48h': 48,
  'week': 168,
  'month': 720,
};

export default function NewsScannerPage() {
  const { add: addToWatchlist, remove: removeFromWatchlist, has: hasWatchlist } = useWatchlist();
  const [filters, setFilters] = useState(buildFilterDefaults);
  const [news, setNews] = useState([]);
  const [stockMap, setStockMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [modal, setModal] = useState({ open: false, url: '', title: '' });
  const [strategyModal, setStrategyModal] = useState({ open: false, badge: null, headline: '', articleUrl: '' });
  const [lastUpdated, setLastUpdated] = useState(null);

  const parsedTickers = useMemo(() => parseTickers(filters.tickersInput), [filters.tickersInput]);

  const filteredNews = useMemo(() => {
    const hasServerFilters = buildFinvizFilterString(filters).length > 0;
    return (news || []).filter(item => {
      const tickers = parseTickers(item.Ticker || '');
      const primary = tickers[0];
      const stock = stockMap[primary];
      const catalysts = detectCatalysts(item.Title || '');
      const date = parseFinvizDate(item.Date || '');

      // If server-side filters active and ticker not in screener results, hide it
      if (hasServerFilters && !stock) return false;

      // freshness
      if (filters.newsFreshness && filters.newsFreshness !== 'any') {
        const diffHrs = (Date.now() - date.getTime()) / (1000 * 60 * 60);
        const maxHrs = FRESHNESS_MAP[filters.newsFreshness];
        if (maxHrs && diffHrs > maxHrs) return false;
      }

      // ticker filter
      if (parsedTickers.length) {
        const matches = tickers.some(t => parsedTickers.includes(t));
        if (!matches) return false;
      }

      // catalyst filter
      if (filters.catalysts.length) {
        const matchesCatalyst = catalysts.some(c => filters.catalysts.includes(c));
        if (!matchesCatalyst) return false;
      }

      // stock-based filters
      if (stock) {
        const price = Number(stock.Price);
        const change = Number((stock.Change || '').replace('%', ''));
        const volume = Number(stock.Volume);
        const relVol = Number(stock['Rel Volume'] || stock['Relative Volume']);
        const score = item._score ?? computeStockScore(stock);

        if (filters.priceMin && price < Number(filters.priceMin)) return false;
        if (filters.priceMax && price > Number(filters.priceMax)) return false;
        if (filters.volumeMin && volume < Number(filters.volumeMin)) return false;
        if (filters.relVolMin && relVol < Number(filters.relVolMin)) return false;
        if (filters.scoreMin && score < Number(filters.scoreMin)) return false;
        if (filters.scoreMax && score > Number(filters.scoreMax)) return false;
        if (filters.changeMin && change < Number(filters.changeMin)) return false;
      }

      return true;
    });
  }, [filters, news, parsedTickers, stockMap]);

  const sortedNews = useMemo(() => {
    return [...filteredNews].sort((a, b) => {
      const da = parseFinvizDate(a.Date || '').getTime();
      const db = parseFinvizDate(b.Date || '').getTime();
      return db - da;
    });
  }, [filteredNews]);

  useEffect(() => {
    fetchNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!news.length) return;
    setNews(prev => prev.map(item => {
      const tickers = parseTickers(item.Ticker || '');
      const stock = stockMap[tickers[0]];
      return { ...item, _score: item._score ?? computeStockScore(stock) };
    }));
  }, [stockMap, news.length]);

  async function fetchStockData(tickers, finvizFilters = '') {
    if (!tickers.length) return {};
    const result = {};
    const batchSize = 50;
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize).join(',');
      try {
        const params = new URLSearchParams({ t: batch });
        if (finvizFilters) params.set('f', finvizFilters);
        const resp = await fetch(`/api/finviz/screener?${params.toString()}`);
        if (!resp.ok) continue;
        const rows = await resp.json();
        (rows || []).forEach(row => { if (row.Ticker) result[row.Ticker] = row; });
      } catch (_) {
        // ignore batch failure
      }
    }
    return result;
  }

  async function fetchNews() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ v: '3', c: '1' });
      if (parsedTickers.length) params.set('t', parsedTickers.join(','));
      const resp = await fetch(`/api/finviz/news-scanner?${params.toString()}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const deduped = Array.isArray(data) ? data : [];
      const tickerSet = new Set();
      deduped.forEach(item => parseTickers(item.Ticker || '').forEach(t => t && tickerSet.add(t)));

      const finvizFilters = buildFinvizFilterString(filters);
      const stocks = await fetchStockData(Array.from(tickerSet), finvizFilters);

      const scored = deduped.map(item => {
        const primary = parseTickers(item.Ticker || '')[0];
        const stock = stocks[primary];
        return { ...item, _score: computeStockScore(stock) };
      });
      setStockMap(stocks);
      setNews(scored);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    setFilters(buildFilterDefaults());
  }

  function exportResults(format) {
    const data = sortedNews.length ? sortedNews : news;
    if (!data.length) return;
    const rows = [];
    data.forEach(item => {
      const tickers = parseTickers(item.Ticker || '');
      const catalysts = detectCatalysts(item.Title || '').join('|');
      const url = item.Url || item.URL || '';
      const source = item.Source || '';
      const published = item.Date || '';
      if (!tickers.length) {
        rows.push({ ticker: 'N/A', headline: item.Title || '', url, catalysts, source, published });
      } else {
        tickers.forEach(t => rows.push({ ticker: t, headline: item.Title || '', url, catalysts, source, published }));
      }
    });
    if (format === 'text') {
      const text = rows.map(r => `${r.ticker} | ${r.headline} | ${r.url} | ${r.catalysts}`).join('\n');
      downloadBlob(text, 'text/plain', 'news-export.txt');
      return;
    }
    const header = ['Ticker', 'Headline', 'Link', 'Type', 'Source', 'Published'];
    const csvLines = [header.join(',')].concat(rows.map(r => {
      return [r.ticker, r.headline, r.url, r.catalysts, r.source, r.published].map(toCsvValue).join(',');
    }));
    downloadBlob(csvLines.join('\n'), 'text/csv', 'news-export.csv');
  }

  function downloadBlob(content, mimeType, filename) {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }


  function openStrategyModal(badge, headline, articleUrl) {
    setStrategyModal({ open: true, badge, headline, articleUrl });
  }

  function closeStrategyModal() {
    setStrategyModal({ open: false, badge: null, headline: '', articleUrl: '' });
  }

  function renderTickerChip(ticker, stock, score, catalystsForTicker, headline, articleUrl) {
    const change = stock ? Number((stock.Change || '').replace('%', '')) : null;
    const price = stock ? Number(stock.Price) : null;
    const changeColor = change == null ? 'var(--text-muted)' : change >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    const inWatchlist = hasWatchlist(ticker);
    const badges = buildBadges(catalystsForTicker || [], score, stock);
    return (
      <div className="ticker-chip" key={ticker}>
        <div className="ticker-chip__header">
          <span className="ticker-chip__symbol">{ticker}</span>
          <button
            className={`btn-icon ${inWatchlist ? 'active' : ''}`}
            title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
            onClick={(e) => {
              e.stopPropagation();
              inWatchlist ? removeFromWatchlist(ticker) : addToWatchlist(ticker, 'news');
            }}
          >
            <Star size={16} />
          </button>
        </div>
        <div className="ticker-chip__meta">
          <span className="ticker-chip__price">{price != null && !Number.isNaN(price) ? `$${price.toFixed(2)}` : '--'}</span>
          <span className="ticker-chip__change" style={{ color: changeColor }}>
            {change != null && !Number.isNaN(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '--'}
          </span>
          <span className="ticker-chip__score" title="Heuristic score">{Math.round(score)}%</span>
        </div>
        {badges.length > 0 && (
          <div className="ticker-chip__badges">
            {badges.map(b => (
              <button
                key={b.label}
                className={`tag-badge tag-badge--clickable ${b.cls}`}
                data-tooltip={b.desc}
                onClick={(e) => {
                  e.stopPropagation();
                  openStrategyModal(b, headline || '', articleUrl || '');
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const activeCount = useMemo(() => {
    return Object.entries(filters).filter(([k, v]) => {
      if (k === 'catalysts') return v.length > 0;
      return v !== '' && v != null;
    }).length;
  }, [filters]);

  return (
    <div className="page-container news-scanner-page">
      <div className="page-header">
        <div>
          <h2>News Scanner</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>Catalyst-focused feed with filters, scoring, exports, and watchlist actions.</p>
          {lastUpdated && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Updated {getTimeAgo(lastUpdated)}</div>}
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => setShowFilters(s => !s)}>
            <SlidersHorizontal size={16} /> {showFilters ? 'Hide Filters' : 'Show Filters'}
            {activeCount > 0 && <span style={{ marginLeft: 4, background: 'var(--accent-blue)', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{activeCount}</span>}
          </button>
          <button className="btn-secondary" onClick={() => exportResults('text')} title="Export as text">
            <Download size={16} /> Export Text
          </button>
          <button className="btn-secondary" onClick={() => exportResults('csv')} title="Export CSV">
            <Download size={16} /> Export CSV
          </button>
          <button className="btn-primary" onClick={fetchNews} disabled={loading}>
            <RefreshCcw size={16} /> {loading ? 'Refreshing\u2026' : 'Refresh Feed'}
          </button>
        </div>
      </div>

      {showFilters && (
        <TabbedFilterPanel filters={filters} setFilters={setFilters} />
      )}

      {error && (
        <div className="panel" style={{ border: '1px solid var(--accent-red)' }}>
          <div style={{ color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <X size={16} /> Failed to load news: {error}
          </div>
        </div>
      )}

      <div className="panel">
        {loading && news.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading catalyst news\u2026</div>
        )}
        {!loading && sortedNews.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>No news found. Adjust filters or refresh.</div>
        )}
        <div className="news-list">
          {sortedNews.map((item, idx) => {
            const tickers = parseTickers(item.Ticker || '');
            const primary = tickers[0];
            const stock = stockMap[primary];
            const catalysts = detectCatalysts(item.Title || '');
            const score = item._score ?? computeStockScore(stock);
            const badges = buildBadges(catalysts, score, stock);
            const freshness = getTimeAgo(parseFinvizDate(item.Date || ''));
            const articleUrl = item.Url || item.URL || '#';
            return (
              <article key={`${articleUrl}-${idx}`} className="news-card">
                <div className="news-card__left">
                  <div className="ticker-grid">
                    {tickers.length
                      ? tickers.map(t => renderTickerChip(t, stockMap[t], score, catalysts, item.Title, articleUrl))
                      : renderTickerChip('N/A', null, 0, catalysts, item.Title, articleUrl)}
                  </div>
                </div>
                <div className="news-card__right">
                  <div className="news-card__topline">
                    <div className="news-card__badges">
                      {catalysts.map(c => <span key={c} className={`catalyst-badge catalyst-${c}`}>{c}</span>)}
                      {badges.map(b => (
                        <button
                          key={b.label}
                          className={`tag-badge tag-badge--clickable ${b.cls}`}
                          data-tooltip={b.desc}
                          onClick={(e) => {
                            e.stopPropagation();
                            openStrategyModal(b, item.Title || '', articleUrl);
                          }}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                    <div className="news-card__meta">
                      <span className="news-source">{item.Source}</span>
                      <span className="news-time">{freshness}</span>
                    </div>
                  </div>
                  <div className="news-card__headline">
                    <button className="link-button" onClick={() => setModal({ open: true, url: articleUrl, title: item.Title || 'Article' })}>
                      {item.Title}
                    </button>
                  </div>
                  <div className="news-card__footer">
                    <div className="news-card__stats">
                      {stock && (
                        <>
                          <span>Price: {stock.Price || '--'}</span>
                          <span>Change: {formatPercent(Number((stock.Change || '').replace('%', '')) || 0)}</span>
                          <span>Volume: {formatNumber(Number(stock.Volume) || 0)}</span>
                          <span>RelVol: {stock['Rel Volume'] || stock['Relative Volume'] || '--'}</span>
                        </>
                      )}
                    </div>
                    <a
                      className="btn-link"
                      href={articleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Original <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* Article iframe modal */}
      {modal.open && (
        <div className="modal-backdrop" onClick={() => setModal({ open: false, url: '', title: '' })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{modal.title}</div>
              <button className="btn-icon" onClick={() => setModal({ open: false, url: '', title: '' })}><X size={16} /></button>
            </div>
            <div className="modal__body" style={{ height: '70vh' }}>
              <iframe title={modal.title} src={modal.url} style={{ width: '100%', height: '100%', border: 'none' }} />
            </div>
            <div className="modal__footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>If the article is blank, open in a new tab.</span>
              <a className="btn-secondary" href={modal.url} target="_blank" rel="noopener noreferrer">Open in new tab</a>
            </div>
          </div>
        </div>
      )}

      {/* Strategy detail modal */}
      {strategyModal.open && strategyModal.badge && (
        <div className="modal-backdrop" onClick={closeStrategyModal}>
          <div className="modal modal--strategy" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`tag-badge ${strategyModal.badge.cls}`}>{strategyModal.badge.label}</span>
                Strategy Guide
              </div>
              <button className="btn-icon" onClick={closeStrategyModal}><X size={16} /></button>
            </div>
            <div className="modal__body" style={{ padding: 20 }}>
              <div className="strategy-section">
                <h4 className="strategy-section__label">Signal Description</h4>
                <p className="strategy-section__text">{strategyModal.badge.desc}</p>
              </div>
              <div className="strategy-section">
                <h4 className="strategy-section__label">Triggering Headline</h4>
                <p className="strategy-section__text">{strategyModal.headline}</p>
              </div>
              <div className="strategy-section">
                <h4 className="strategy-section__label">Strategy Suggestions</h4>
                <ul className="strategy-list">
                  {(strategyModal.badge.strategies || []).map((s, i) => (
                    <li key={i} className="strategy-list__item">{s}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="modal__footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn-secondary" onClick={closeStrategyModal}>Close</button>
              {strategyModal.articleUrl && strategyModal.articleUrl !== '#' && (
                <a
                  className="btn-primary"
                  href={strategyModal.articleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
                >
                  <ExternalLink size={14} /> Read Full Article
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
