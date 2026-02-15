import { useMemo, useState } from 'react';
import useApi from '../../hooks/useApi';
import useWatchlist from '../../hooks/useWatchlist';
import SortableTable from '../shared/SortableTable';
import ResearchPanel from '../watchlist/ResearchPanel';
import { renderSymbolLink, renderPercentColor, renderRvol, renderVolumeCell, renderPrice } from '../../utils/tableCells.jsx';
import { formatFloat, formatMarketCap, getTimeAgo } from '../../utils/formatters';
import { Star, RefreshCw, AlertCircle } from 'lucide-react';

export default function GappersPage({ title = 'Premarket Gappers', endpoint = '/api/gappers?limit=80&news=1' }) {
  const { add, remove, has } = useWatchlist();
  const [selectedTicker, setSelectedTicker] = useState(null);

  const { data, loading, error, refetch } = useApi(endpoint, [], {
    pollMs: 15000,
    pauseWhenHidden: true,
  });

  const rows = useMemo(() => data?.gappers || [], [data]);

  const columns = useMemo(() => [
    { key: 'symbol', label: 'Symbol', render: (row) => renderSymbolLink(row.symbol, setSelectedTicker) },
    { key: 'preMarketChangePercent', label: 'PM %', align: 'right', render: (row) => renderPercentColor(row.preMarketChangePercent), sortValue: (row) => row.preMarketChangePercent },
    { key: 'preMarketPrice', label: 'PM Price', align: 'right', render: (row) => renderPrice(row.preMarketPrice), sortValue: (row) => row.preMarketPrice },
    { key: 'prevClose', label: 'Prev Close', align: 'right', render: (row) => renderPrice(row.prevClose), sortValue: (row) => row.prevClose },
    { key: 'price', label: 'Last', align: 'right', render: (row) => renderPrice(row.price), sortValue: (row) => row.price },
    { key: 'rvol', label: 'RVOL', align: 'right', render: (row) => renderRvol(row.rvol), sortValue: (row) => row.rvol },
    { key: 'floatShares', label: 'Float', align: 'right', render: (row) => row.floatShares ? `${formatFloat(row.floatShares / 1e6)}M` : '--', sortValue: (row) => row.floatShares },
    { key: 'avgVolume', label: 'Avg Vol', align: 'right', render: (row) => renderVolumeCell(row.avgVolume), sortValue: (row) => row.avgVolume },
    { key: 'marketCap', label: 'Mkt Cap', align: 'right', render: (row) => formatMarketCap(row.marketCap), sortValue: (row) => row.marketCap },
    {
      key: 'headline', label: 'Catalyst', sortable: false,
      render: (row) => {
        if (row.headline) {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 600 }}>{row.catalyst || 'News'}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{row.headline}</span>
              {row.headlineTime && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{getTimeAgo(row.headlineTime)}</span>}
            </div>
          );
        }
        return <span style={{ color: 'var(--text-muted)' }}>--</span>;
      }
    },
    {
      key: 'watch', label: '', sortable: false,
      render: (row) => {
        const inList = has(row.symbol);
        return (
          <button className="btn-icon" title={inList ? 'Remove from watchlist' : 'Add to watchlist'}
            aria-label={inList ? `Remove ${row.symbol}` : `Add ${row.symbol}`}
            onClick={(e) => { e.stopPropagation(); inList ? remove(row.symbol) : add(row.symbol, 'premarket'); }}>
            <Star size={16} fill={inList ? 'var(--accent-orange)' : 'none'} color={inList ? 'var(--accent-orange)' : 'var(--text-muted)'} />
          </button>
        );
      }
    }
  ], [add, remove, has]);

  return (
    <div className="watchlist-page">
      <div className="watchlist-page__controls">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {loading && <RefreshCw size={16} className="spin" />}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary btn-sm" onClick={refetch}>Manual Refresh</button>
        </div>
      </div>

      {error && (
        <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <AlertCircle size={16} />
          <span>Could not load gappers: {error}</span>
        </div>
      )}

      <div className="watchlist-page__content">
        <div className={`watchlist-page__table ${selectedTicker ? 'watchlist-page__table--narrow' : ''}`}>
          <SortableTable
            columns={columns}
            data={rows}
            rowKey={(row) => row.symbol}
            onRowClick={(row) => setSelectedTicker(row.symbol)}
            rowClassName={(row) => selectedTicker === row.symbol ? 'row--selected' : ''}
            virtualizeThreshold={300}
          />
        </div>
        {selectedTicker && (
          <ResearchPanel
            symbol={selectedTicker}
            onClose={() => setSelectedTicker(null)}
          />
        )}
      </div>
    </div>
  );
}
