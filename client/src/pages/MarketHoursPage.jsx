import React from 'react';
import useApi from '../hooks/useApi';
import { formatNumber } from '../utils/formatters';

export default function MarketHoursPage() {
  const { data: status, loading } = useApi('/api/market-status', []);
  const { data: heatmap } = useApi('/api/finviz/screener?v=111&t=AAPL'); // lightweight ping to keep panel filled

  return (
    <div className="page-container">
      <div className="panel" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Market Hours</h2>
        <p className="muted" style={{ marginTop: 4 }}>Session clock and quick pulse of market breadth.</p>
      </div>

      <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 12 }}>
        <StatCard label="Status" value={status ? (status.isOpen ? 'Open' : 'Closed') : '—'} highlight={status?.isOpen} loading={loading} />
        <StatCard label="Next Session" value={status?.nextSession || '--'} loading={loading} />
        <StatCard label="Current Session" value={status?.session || '--'} loading={loading} />
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>SPY Snapshot</h3>
        {heatmap && Array.isArray(heatmap) && heatmap[0] && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="stat-card">
              <div className="stat-label">Price</div>
              <div className="stat-value">${formatNumber(heatmap[0].Price)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Change</div>
              <div className={String(heatmap[0].Change || '').includes('-') ? 'text-negative' : 'text-positive'}>{heatmap[0].Change || '--'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Volume</div>
              <div className="stat-value">{formatNumber(heatmap[0].Volume)}</div>
            </div>
          </div>
        )}
        {!heatmap && <div className="muted">Pulling latest quotes…</div>}
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight, loading }) {
  return (
    <div className="stat-card" style={{ padding: 14, border: highlight ? '1px solid var(--accent-green)' : '1px solid var(--border-color)' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: highlight ? 'var(--accent-green)' : undefined }}>
        {loading ? 'Loading…' : value}
      </div>
    </div>
  );
}
