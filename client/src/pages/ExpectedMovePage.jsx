import React, { useEffect, useState } from 'react';
import { RefreshCcw, AlertCircle } from 'lucide-react';
import { formatNumber, formatPercent } from '../utils/formatters';

export default function ExpectedMovePage() {
  const [ticker, setTicker] = useState('AAPL');
  const [input, setInput] = useState('AAPL');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData('AAPL');
  }, []);

  async function fetchData(sym) {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/expected-move-enhanced?ticker=${encodeURIComponent(sym)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setData(json);
      setTicker(sym);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) fetchData(input.trim().toUpperCase());
  };

  const prob = data?.probability || {};
  const options = data?.options || {};
  const scoring = data?.scoring || {};

  return (
    <div className="page-container">
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-header">
          <div>
            <h2 style={{ margin: 0 }}>Expected Move Engine</h2>
            <p className="muted" style={{ marginTop: 4 }}>ATM straddle derived move, 1SD containment probability, and composite confidence.</p>
          </div>
          <button className="btn-secondary btn-sm" onClick={() => fetchData(ticker)}><RefreshCcw size={14} /> Refresh</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <input className="input-field" style={{ maxWidth: 200 }} value={input} onChange={e => setInput(e.target.value)} placeholder="Ticker" />
          <button className="btn-primary" type="submit">Analyze</button>
        </form>
      </div>

      {error && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        </div>
      )}

      {data && (
        <div className="panel" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12 }}>
          <div>
            <h3 style={{ marginTop: 0 }}>{ticker}</h3>
            <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginBottom: 12 }}>
              <div>
                <div className="muted">Price</div>
                <div className="stat-value">${formatNumber(data.price)}</div>
              </div>
              <div>
                <div className="muted">Change</div>
                <div className={data.changePercent >= 0 ? 'text-positive' : 'text-negative'}>
                  {formatNumber(data.change)} ({formatPercent(data.changePercent)})
                </div>
              </div>
            </div>

            <div className="stat-card" style={{ marginBottom: 12 }}>
              <div className="stat-label">Expected Move ({options.expirationDate || 'nearest expiry'})</div>
              <div className="stat-value">±${formatNumber(data.expectedMove)} ({formatPercent(data.expectedMovePercent)})</div>
              <div className="muted">Range: ${formatNumber(data.rangeLow)} – ${formatNumber(data.rangeHigh)}</div>
              <div className="muted">Containment: {prob.containment != null ? `${prob.containment}%` : '--'} · Breach: {prob.breach != null ? `${prob.breach}%` : '--'} · {prob.method}</div>
            </div>

            <div className="stat-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <div>
                <div className="stat-label">ATM Call</div>
                <div className="muted">{options.atmCall ? `$${formatNumber(options.atmCall.mid)} · IV ${formatPercent(options.atmCall.iv * 100)}` : '--'}</div>
              </div>
              <div>
                <div className="stat-label">ATM Put</div>
                <div className="muted">{options.atmPut ? `$${formatNumber(options.atmPut.mid)} · IV ${formatPercent(options.atmPut.iv * 100)}` : '--'}</div>
              </div>
              <div>
                <div className="stat-label">Days to Expiry</div>
                <div className="stat-value">{options.daysToExpiry ?? '--'}</div>
              </div>
              <div>
                <div className="stat-label">Earnings</div>
                <div className="muted">{data.earnings?.nextDate || 'None'}{data.earnings?.nextInDays ? ` (${data.earnings.nextInDays}d)` : ''}</div>
              </div>
            </div>
          </div>

          <div className="stat-card" style={{ alignSelf: 'start' }}>
            <div className="stat-label">Composite Confidence</div>
            <div className="stat-value" style={{ fontSize: 42 }}>{scoring?.composite ?? '--'}</div>
            <div className="muted">{scoring?.tier || ''}</div>
            {scoring?.breakdown && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {scoring.breakdown.slice(0, 5).map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="muted">{item.factor}</span>
                    <span>{item.points}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {loading && <div className="panel">Loading expected move…</div>}
    </div>
  );
}
