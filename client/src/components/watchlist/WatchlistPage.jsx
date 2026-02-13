import { useState, useMemo } from 'react';
import useWatchlist from '../../hooks/useWatchlist';
import useApi from '../../hooks/useApi';
import SourceFilter from './SourceFilter';
import ResearchPanel from './ResearchPanel';
import TickerChip from '../shared/TickerChip';
import SourceBadge from '../shared/SourceBadge';
import SortableTable from '../shared/SortableTable';
import { formatCurrency, formatPercent, formatMarketCap, getTimeAgo } from '../../utils/formatters';
import { SOURCE_COLORS } from '../../utils/constants';
import { Plus, Download } from 'lucide-react';

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
    quoteData?.quotes?.forEach(q => { m[q.ticker] = q; });
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

  const handleExportCSV = () => {
    if (!tableData.length) return;
    const headers = ['Symbol', 'Company', 'Price', 'Change %', 'Market Cap', 'Source', 'Added'];
    const rows = tableData.map(row => [
      row.symbol || '',
      `"${(row.shortName || '').replace(/"/g, '""')}"`,
      row.price != null ? row.price : '',
      row.changePercent != null ? row.changePercent.toFixed(2) : '',
      row.marketCap || '',
      row.source || '',
      row.addedAt || '',
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filterLabel = sourceFilter === 'all' ? 'all' : sourceFilter;
    a.download = `watchlist-${filterLabel}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = [
    {
      key: 'symbol', label: 'Symbol', render: (row) => (
        <span style={{ color: 'var(--accent-blue)', fontWeight: 600, cursor: 'pointer' }}
              onClick={() => setSelectedTicker(row.symbol)}>
          {row.symbol}
        </span>
      ),
    },
    { key: 'shortName', label: 'Company' },
    {
      key: 'price', label: 'Price', align: 'right',
      render: (row) => formatCurrency(row.price),
      sortValue: (row) => row.price,
    },
    {
      key: 'changePercent', label: 'Change %', align: 'right',
      render: (row) => (
        <span style={{ color: row.changePercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
          {formatPercent(row.changePercent)}
        </span>
      ),
      sortValue: (row) => row.changePercent,
    },
    {
      key: 'marketCap', label: 'Market Cap', align: 'right',
      render: (row) => formatMarketCap(row.marketCap),
      sortValue: (row) => row.marketCap,
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
          <button className="btn-secondary btn-sm" onClick={handleExportCSV} title="Export CSV" disabled={!tableData.length}>
            <Download size={16} /> Export CSV
          </button>
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

      <div className="watchlist-page__content">
        <div className={`watchlist-page__table ${selectedTicker ? 'watchlist-page__table--narrow' : ''}`}>
          <SortableTable
            columns={columns}
            data={tableData}
            rowKey={(row) => row.symbol}
            onRowClick={(row) => setSelectedTicker(row.symbol)}
            rowClassName={(row) => selectedTicker === row.symbol ? 'row--selected' : ''}
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
