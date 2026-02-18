import { useState, useMemo } from 'react';
import useWatchlist from '../../hooks/useWatchlist';
import useApi from '../../hooks/useApi';
import SourceFilter from './SourceFilter';
import ResearchModal from './ResearchModal';
import TickerChip from '../shared/TickerChip';
import SourceBadge from '../shared/SourceBadge';
import SortableTable from '../shared/SortableTable';
import ExportButtons from '../shared/ExportButtons';
import { formatCurrency, formatPercent, formatMarketCap, formatNumber, formatVolume, getTimeAgo } from '../../utils/formatters';
import { renderSymbolLink, renderPrice, renderPercentColor, renderMarketCapCell } from '../../utils/tableCells.jsx';
import { SOURCE_COLORS } from '../../utils/constants';
import { Plus } from 'lucide-react';

export default function WatchlistPage() {
  const { items, add, remove } = useWatchlist();
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [addInput, setAddInput] = useState('');

  const filtered = useMemo(() => {
    if (sourceFilter === 'all') return items;
    return items.filter(i =>
      sourceFilter === 'screener'
        ? i.source === 'screener' || i.source === 'advanced-screener'
        : i.source === sourceFilter
    );
  }, [items, sourceFilter]);

  // Group by source for chip view
  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(item => {
      const key = item.source || 'manual';
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Batch quote fetch
  const symbols = items.map(i => i.symbol).join(',');
  const { data: quoteData } = useApi(symbols ? `/api/yahoo/quote-batch?symbols=${symbols}` : null);
  const quoteMap = useMemo(() => {
    const m = {};
    quoteData?.quotes?.forEach(q => { m[q.symbol] = q; });
    return m;
  }, [quoteData]);

  const tableData = useMemo(() => {
    return filtered.map(item => ({
      ...item,
      ...(quoteMap[item.symbol] || {}),
    }));
  }, [filtered, quoteMap]);

  const handleAdd = (e) => {
    e.preventDefault();
    if (addInput.trim()) {
      add(addInput.trim(), 'manual');
      setAddInput('');
    }
  };

  const exportColumns = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'shortName', label: 'Company', accessor: r => r.shortName || '' },
    { key: 'price', label: 'Price', accessor: r => r.price != null ? r.price : '' },
    { key: 'changePercent', label: 'Change %', accessor: r => r.changePercent != null ? r.changePercent.toFixed(2) : '' },
    { key: 'marketCap', label: 'Market Cap', accessor: r => r.marketCap || '' },
    { key: 'volume', label: 'Volume', accessor: r => r.volume || '' },
    { key: 'rvol', label: 'RVol', accessor: r => r.rvol || '' },
    { key: 'floatShares', label: 'Float', accessor: r => r.floatShares || '' },
    { key: 'source', label: 'Source', accessor: r => r.source || '' },
    { key: 'addedAt', label: 'Added', accessor: r => r.addedAt || '' },
  ];

  const columns = [
    {
      key: 'symbol', label: 'Symbol', render: (row) => renderSymbolLink(row.symbol, setSelectedTicker),
    },
    { key: 'shortName', label: 'Company' },
    {
      key: 'price', label: 'Price', align: 'right',
      render: (row) => renderPrice(row.price),
      sortValue: (row) => row.price,
    },
    {
      key: 'changePercent', label: 'Change %', align: 'right',
      render: (row) => renderPercentColor(row.changePercent),
      sortValue: (row) => row.changePercent,
    },
    {
      key: 'marketCap', label: 'Market Cap', align: 'right',
      render: (row) => renderMarketCapCell(row.marketCap),
      sortValue: (row) => row.marketCap,
    },
    {
      key: 'volume', label: 'Volume', align: 'right',
      render: (row) => row.volume != null ? formatVolume(row.volume) : '--',
      sortValue: (row) => row.volume || 0,
    },
    {
      key: 'rvol', label: 'RVol', align: 'right',
      render: (row) => row.rvol != null ? (
        <span style={{ color: row.rvol >= 2 ? 'var(--accent-green)' : row.rvol >= 1.5 ? 'var(--accent-orange)' : undefined }}>
          {row.rvol.toFixed(2)}
        </span>
      ) : '--',
      sortValue: (row) => row.rvol || 0,
    },
    {
      key: 'floatShares', label: 'Float', align: 'right',
      render: (row) => row.floatShares != null ? formatNumber(row.floatShares) : '--',
      sortValue: (row) => row.floatShares || 0,
    },
    {
      key: 'source', label: 'Source',
      render: (row) => <SourceBadge source={row.source} />,
    },
    {
      key: 'addedAt', label: 'Added', render: (row) => row.addedAt ? getTimeAgo(row.addedAt) : '--',
      sortValue: (row) => row.addedAt ? new Date(row.addedAt).getTime() : 0,
    },
    {
      key: 'actions', label: '', sortable: false,
      render: (row) => (
        <button
          className="btn-icon"
          title="Remove"
          aria-label={`Remove ${row.symbol}`}
          onClick={(e) => { e.stopPropagation(); remove(row.symbol); }}
        >
          &times;
        </button>
      ),
    },
  ];

  return (
    <div className="watchlist-page">
      <div className="watchlist-page__controls">
        <SourceFilter active={sourceFilter} onChange={setSourceFilter} />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <ExportButtons
            data={tableData}
            columns={exportColumns}
            filename={`watchlist-${sourceFilter === 'all' ? 'all' : sourceFilter}-${new Date().toISOString().split('T')[0]}`}
          />
          <form className="watchlist-add-form" onSubmit={handleAdd}>
            <input
              type="text"
              placeholder="Add ticker..."
              value={addInput}
              onChange={e => setAddInput(e.target.value.toUpperCase())}
              className="input-field"
            />
            <button type="submit" className="btn-primary btn-sm"><Plus size={16} /> Add</button>
          </form>
        </div>
      </div>

      {/* Grouped chip view */}
      <div className="watchlist-chips">
        {grouped.map(([source, sourceItems]) => (
          <div key={source} className="watchlist-chips__group">
            <div className="watchlist-chips__label" style={{ color: (SOURCE_COLORS[source] || SOURCE_COLORS.manual).color }}>
              {(SOURCE_COLORS[source] || SOURCE_COLORS.manual).label}
              <span className="watchlist-chips__count">{sourceItems.length}</span>
            </div>
            <div className="watchlist-chips__list">
              {sourceItems.map(item => (
                <TickerChip
                  key={item.symbol}
                  symbol={item.symbol}
                  source={item.source}
                  selected={selectedTicker === item.symbol}
                  onClick={setSelectedTicker}
                  onRemove={remove}
                />
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 'var(--spacing-lg)', textAlign: 'center' }}>
            No watchlist items. Add a ticker above or use screeners to add symbols.
          </div>
        )}
      </div>

      <SortableTable
        columns={columns}
        data={tableData}
        rowKey={(row) => row.symbol}
        onRowClick={(row) => setSelectedTicker(row.symbol)}
        rowClassName={(row) => selectedTicker === row.symbol ? 'row--selected' : ''}
        virtualizeThreshold={400}
      />
      {selectedTicker && (
        <ResearchModal
          symbol={selectedTicker}
          onClose={() => setSelectedTicker(null)}
        />
      )}
    </div>
  );
}
