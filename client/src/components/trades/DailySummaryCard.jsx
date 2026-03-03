import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Target, BarChart2 } from 'lucide-react';
import { authFetch } from '../../utils/api';

export default function DailySummaryCard({ scope = 'user', refreshKey }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    authFetch(`/api/trades/summary?scope=${scope}&from=${today}&to=${today}T23:59:59Z`)
      .then(r => r.json())
      .then(data => { setSummary(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [scope, refreshKey]);

  if (loading) return <div className="panel summary-card"><p className="muted">Loading summary...</p></div>;
  if (!summary || summary.error || !summary.totalTrades) return <div className="panel summary-card"><p className="muted">No closed trades today.</p></div>;

  const totalPnl = +(summary.totalPnl || 0);
  const pnlColor = totalPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

  return (
    <div className="panel summary-card">
      <h3 className="panel-title">Today's Summary</h3>
      <div className="summary-grid">
        <div className="summary-stat">
          <div className="summary-stat-icon" style={{ color: pnlColor }}>
            {totalPnl >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
          </div>
          <div className="summary-stat-value" style={{ color: pnlColor }}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
          </div>
          <div className="summary-stat-label">Total P&L</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat-icon"><Target size={20} /></div>
          <div className="summary-stat-value">{summary.wins || 0}W / {summary.losses || 0}L</div>
          <div className="summary-stat-label">{summary.winRate || 0}% Win Rate</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat-icon"><BarChart2 size={20} /></div>
          <div className="summary-stat-value">{summary.totalTrades || 0}</div>
          <div className="summary-stat-label">Total Trades</div>
        </div>
        <div className="summary-stat">
          <div className="summary-stat-icon" style={{ color: 'var(--accent-green)' }}>
            <TrendingUp size={20} />
          </div>
          <div className="summary-stat-value" style={{ color: 'var(--accent-green)' }}>+{(summary.biggestWinner || 0).toFixed(2)}</div>
          <div className="summary-stat-label">Best Trade</div>
        </div>
      </div>
    </div>
  );
}
