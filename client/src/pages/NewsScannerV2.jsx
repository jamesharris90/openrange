import { useEffect, useMemo, useState } from 'react';
import { BarChart3, ExternalLink, Info, RefreshCw } from 'lucide-react';
import Card from '../components/shared/Card';
import NewsButton from '../components/shared/NewsButton';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { getTimeAgo } from '../features/news/NewsScannerLogic';
import { apiJSON } from '@/config/api';

const FRESHNESS_OPTIONS = ['1h', '6h', '24h'];
const CATALYST_OPTIONS = ['earnings', 'guidance', 'merger', 'fda', 'contract', 'offering', 'analyst', 'general'];

function scoreBand(score) {
  if (score >= 85) return 'strong';
  if (score >= 60) return 'teal';
  if (score >= 30) return 'warn';
  return 'weak';
}

function breakdownText(breakdown = {}) {
  return [
    `Recency: ${breakdown.recency_score ?? 0}`,
    `Source: ${breakdown.source_score ?? 0}`,
    `Keyword: ${breakdown.keyword_score ?? 0}`,
    `Analyst Boost: ${breakdown.analyst_boost_score ?? 0}`,
    `Reinforcement: ${breakdown.reinforcement_score ?? 0}`,
    `Symbol relevance: ${breakdown.symbol_relevance_score ?? 0}`,
  ].join(' | ');
}

function buildQuery(filters) {
  const params = new URLSearchParams();

  if (filters.symbols) params.set('symbols', filters.symbols);
  if (filters.minScore !== '') params.set('minScore', String(filters.minScore));
  if (filters.maxScore !== '') params.set('maxScore', String(filters.maxScore));
  if (filters.freshness) params.set('freshness', filters.freshness);
  if (filters.catalyst) params.set('catalyst', filters.catalyst);
  if (filters.priceMin !== '') params.set('priceMin', String(filters.priceMin));
  if (filters.priceMax !== '') params.set('priceMax', String(filters.priceMax));
  if (filters.sector) params.set('sector', filters.sector);
  if (filters.marketCapMin !== '') params.set('marketCapMin', String(filters.marketCapMin));
  if (filters.marketCapMax !== '') params.set('marketCapMax', String(filters.marketCapMax));
  if (filters.limit !== '') params.set('limit', String(filters.limit));
  params.set('sort', filters.sort || 'score');

  return params.toString();
}

function NewsScannerV2() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState('');
  const [activeRow, setActiveRow] = useState(null);
  const [filters, setFilters] = useState({
    symbols: '',
    minScore: '',
    maxScore: '',
    freshness: '',
    catalyst: '',
    priceMin: '',
    priceMax: '',
    sector: '',
    marketCapMin: '',
    marketCapMax: '',
    limit: 50,
    sort: 'recency',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);

  const normalizedSymbols = useMemo(
    () => String(appliedFilters.symbols || '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
    [appliedFilters.symbols]
  );

  async function loadNews(nextFilters = appliedFilters) {
    setLoading(true);
    setError('');
    try {
      const query = buildQuery(nextFilters);
      const data = await apiJSON(`/api/news/v3?${query}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to load news');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function refreshNews() {
    if (!normalizedSymbols.length) {
      setError('Enter at least one symbol to refresh.');
      return;
    }

    setRefreshing(true);
    setError('');
    try {
      const params = new URLSearchParams({ symbols: normalizedSymbols.join(',') });
      await apiJSON(`/api/news/v3/refresh?${params.toString()}`, { method: 'POST' });
      await loadNews(appliedFilters);
    } catch (err) {
      setError(err.message || 'Failed to refresh news');
    } finally {
      setRefreshing(false);
    }
  }

  function applyFilters() {
    setAppliedFilters(filters);
  }

  useEffect(() => {
    loadNews(appliedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFilters]);

  return (
    <div className="page-container news-scanner-page space-y-3">
      <Card className="ns-command-shell">
        <div className="ns-command-bar">
          <div className="ns-heading">
            <h2 className="m-0">News Intelligence</h2>
            <p className="mt-1">Canonical v3 feed with deterministic score, catalyst, and metadata filters.</p>
          </div>
          <div className="page-actions ns-command-actions">
            <NewsButton variant="primary" onClick={refreshNews} disabled={refreshing} icon={<RefreshCw size={16} strokeWidth={2} />}>
              {refreshing ? 'Refreshing…' : 'Refresh Ingestion'}
            </NewsButton>
            <NewsButton variant="secondary" onClick={() => loadNews(appliedFilters)} disabled={loading}>
              {loading ? 'Loading…' : 'Reload'}
            </NewsButton>
          </div>
        </div>

        <div className="ns-command-subrow" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))', gap: 12 }}>
          <label className="muted text-sm">Symbols
            <input type="text" value={filters.symbols} onChange={(e) => setFilters((prev) => ({ ...prev, symbols: e.target.value }))} placeholder="AMD,SHOP" />
          </label>

          <label className="muted text-sm">Min Score
            <input type="number" value={filters.minScore} onChange={(e) => setFilters((prev) => ({ ...prev, minScore: e.target.value }))} />
          </label>

          <label className="muted text-sm">Max Score
            <input type="number" value={filters.maxScore} onChange={(e) => setFilters((prev) => ({ ...prev, maxScore: e.target.value }))} />
          </label>

          <label className="muted text-sm">Freshness
            <select value={filters.freshness} onChange={(e) => setFilters((prev) => ({ ...prev, freshness: e.target.value }))}>
              <option value="">Any</option>
              {FRESHNESS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>

          <label className="muted text-sm">Catalyst
            <select value={filters.catalyst} onChange={(e) => setFilters((prev) => ({ ...prev, catalyst: e.target.value }))}>
              <option value="">Any</option>
              {CATALYST_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>

          <label className="muted text-sm">Price Min
            <input type="number" value={filters.priceMin} onChange={(e) => setFilters((prev) => ({ ...prev, priceMin: e.target.value }))} />
          </label>

          <label className="muted text-sm">Price Max
            <input type="number" value={filters.priceMax} onChange={(e) => setFilters((prev) => ({ ...prev, priceMax: e.target.value }))} />
          </label>

          <label className="muted text-sm">Sector
            <input type="text" value={filters.sector} onChange={(e) => setFilters((prev) => ({ ...prev, sector: e.target.value }))} placeholder="Technology" />
          </label>

          <label className="muted text-sm">Market Cap Min
            <input type="number" value={filters.marketCapMin} onChange={(e) => setFilters((prev) => ({ ...prev, marketCapMin: e.target.value }))} />
          </label>

          <label className="muted text-sm">Market Cap Max
            <input type="number" value={filters.marketCapMax} onChange={(e) => setFilters((prev) => ({ ...prev, marketCapMax: e.target.value }))} />
          </label>

          <label className="muted text-sm">Limit
            <input type="number" value={filters.limit} onChange={(e) => setFilters((prev) => ({ ...prev, limit: e.target.value }))} min="1" max="500" />
          </label>

          <label className="muted text-sm">Sort
            <select value={filters.sort} onChange={(e) => setFilters((prev) => ({ ...prev, sort: e.target.value }))}>
              <option value="score">Score</option>
              <option value="recency">Recency</option>
            </select>
          </label>
        </div>

        <div className="mt-3">
          <NewsButton variant="primary" onClick={applyFilters}>Apply Filters</NewsButton>
        </div>
      </Card>

      {error && <Card className="ns-error-card"><div className="ns-error-text">{error}</div></Card>}

      {activeRow && (
        <Card className="ns-intel-section">
          <h4>{activeRow.symbol} · {activeView}</h4>
          <p><strong>{activeRow.headline}</strong></p>
          <p>Score: {activeRow.news_score}</p>
          <p>{breakdownText(activeRow.score_breakdown)}</p>
          <p>Catalysts: {(activeRow.catalyst_tags || []).join(', ') || '—'}</p>
        </Card>
      )}

      <Card className="ns-feed-pane">
        {loading && <LoadingSpinner message="Loading news intelligence…" />}
        {!loading && rows.length === 0 && <div className="ns-state-empty">No results for current filters.</div>}
        <div className="news-list ns-news-list">
          {rows.map((item) => {
            const band = scoreBand(Number(item.news_score) || 0);
            const publishedTs = item.publishedAt ? new Date(item.publishedAt) : null;

            return (
              <article key={item.id} className={`news-card ns-news-card ns-news-card--${band}`}>
                <div className="ns-card-grid" style={{ gridTemplateColumns: '15% 1fr' }}>
                  <div className="ns-card-left">
                    <div className="ticker-chip ns-ticker-block">
                      <div className="ticker-chip__header ns-ticker-block__header">
                        <button className="ticker-chip__symbol ns-ticker-pill">{item.symbol || '—'}</button>
                      </div>
                      <div className="ticker-chip__meta ns-ticker-block__meta">
                        <div className="ns-ticker-inline-row ns-ticker-inline-row--bottom">
                          <span className="ns-score-wrap" title={breakdownText(item.score_breakdown)}>
                            <span className={`ns-score-circle ns-score-circle--${band}`}>{Math.round(Number(item.news_score) || 0)}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="ns-card-right">
                    <div className="ns-card-headline">{item.headline}</div>
                    <div className="ns-card-meta">
                      <span className="news-source">{item.source || 'Unknown'}</span>
                      <span className="news-time">{publishedTs ? getTimeAgo(publishedTs) : 'Unknown time'}</span>
                      <span className="news-source">Price: {item.price ?? '—'}</span>
                      <span className="news-source">Sector: {item.sector || '—'}</span>
                    </div>
                    <div className="ns-card-preview">{(item.catalyst_tags || []).length ? `Catalysts: ${item.catalyst_tags.join(', ')}` : 'No catalyst tags'}</div>

                    <div className="ns-card-actions">
                      <NewsButton variant="secondary" size="sm" icon={<BarChart3 size={16} />} onClick={() => { setActiveView('Market Behaviour'); setActiveRow(item); }}>
                        Market Behaviour
                      </NewsButton>
                      <NewsButton variant="primary" size="sm" icon={<Info size={16} />} onClick={() => { setActiveView('View Details'); setActiveRow(item); }}>
                        View Details
                      </NewsButton>
                      <NewsButton as="a" variant="secondary" size="sm" href={item.url || '#'} target="_blank" rel="noopener noreferrer" icon={<ExternalLink size={16} />}>
                        Open Original Article
                      </NewsButton>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

export default NewsScannerV2;
