import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { authFetch } from '../../utils/api';
import SortableTable from '../shared/SortableTable';

const FILTERS = ['all', 'open', 'closed', 'wins', 'losses'];

export default function JournalTab({ scope }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    setLoading(true);
    authFetch(`/api/trades?scope=${scope}&limit=500`)
      .then(r => r.json())
      .then(data => { setTrades(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [scope]);

  const filtered = useMemo(() => {
    if (filter === 'all') return trades;
    if (filter === 'open') return trades.filter(t => t.status === 'open');
    if (filter === 'closed') return trades.filter(t => t.status === 'closed');
    if (filter === 'wins') return trades.filter(t => (t.pnl_dollar || 0) > 0);
    if (filter === 'losses') return trades.filter(t => (t.pnl_dollar || 0) < 0);
    return trades;
  }, [trades, filter]);

  const columns = useMemo(() => [
    {
      key: 'opened_at', label: 'Date', sortable: true,
      sortValue: r => new Date(r.opened_at).getTime(),
      render: r => new Date(r.opened_at).toLocaleDateString(),
    },
    { key: 'symbol', label: 'Symbol', sortable: true },
    {
      key: 'side', label: 'Side', sortable: true,
      render: r => <span className={`badge ${r.side === 'long' ? 'badge-green' : 'badge-red'}`}>{r.side}</span>,
    },
    { key: 'entry_price', label: 'Entry', align: 'right', sortable: true, render: r => (+r.entry_price).toFixed(2) },
    { key: 'exit_price', label: 'Exit', align: 'right', sortable: true, render: r => r.exit_price ? (+r.exit_price).toFixed(2) : '—' },
    {
      key: 'pnl_dollar', label: 'P&L $', align: 'right', sortable: true,
      render: r => r.pnl_dollar != null
        ? <span style={{ color: r.pnl_dollar >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{r.pnl_dollar >= 0 ? '+' : ''}{(+r.pnl_dollar).toFixed(2)}</span>
        : '—',
    },
    {
      key: 'pnl_percent', label: 'P&L %', align: 'right', sortable: true,
      render: r => r.pnl_percent != null
        ? <span style={{ color: r.pnl_percent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{r.pnl_percent >= 0 ? '+' : ''}{(+r.pnl_percent).toFixed(2)}%</span>
        : '—',
    },
    {
      key: 'duration_seconds', label: 'Duration', align: 'right', sortable: true,
      render: r => {
        if (!r.duration_seconds) return '—';
        const m = Math.round(r.duration_seconds / 60);
        return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
      },
    },
    { key: 'setup_type', label: 'Setup', sortable: true, render: r => r.setup_type || '—' },
    {
      key: 'expand', label: '', sortable: false, align: 'center',
      render: r => r.notes ? (expandedId === r.trade_id ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null,
    },
  ], [expandedId]);

  if (loading) return <div className="muted" style={{ padding: 24 }}>Loading trades...</div>;

  return (
    <div>
      <div className="journal-filters">
        {FILTERS.map(f => (
          <button key={f} className={`filter-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span className="muted" style={{ marginLeft: 'auto' }}>{filtered.length} trades</span>
      </div>

      <SortableTable
        columns={columns}
        data={filtered}
        rowKey={r => r.trade_id}
        onRowClick={r => r.notes ? setExpandedId(expandedId === r.trade_id ? null : r.trade_id) : null}
        rowClassName={r => expandedId === r.trade_id ? 'row-expanded' : ''}
      />

      {expandedId && (() => {
        const trade = trades.find(t => t.trade_id === expandedId);
        if (!trade || !trade.notes) return null;
        return (
          <div className="journal-detail panel">
            <div className="journal-detail-row">
              {trade.setup_type && <span className="badge">{trade.setup_type}</span>}
              {trade.conviction && <span className="muted">Conviction: {trade.conviction}/5</span>}
            </div>
            {trade.notes && <p className="journal-notes">{trade.notes}</p>}
          </div>
        );
      })()}
    </div>
  );
}
