import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { authFetch } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const SETUP_TYPES = ['breakout', 'pullback', 'gap fill', 'momentum', 'reversal', 'scalp', 'swing'];

export default function TradeEntryPanel({ onSaved, onClose }) {
  const { success, error: showError } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    symbol: '', side: 'long', entryPrice: '', exitPrice: '',
    qty: '', commission: '', openedAt: new Date().toISOString().slice(0, 16),
    closedAt: '', setupType: '', conviction: '', notes: '',
  });

  const update = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.symbol || !form.entryPrice || !form.qty) {
      showError('Symbol, entry price, and quantity are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch('/api/trades', {
        method: 'POST',
        body: JSON.stringify({
          symbol: form.symbol.toUpperCase(),
          side: form.side,
          entryPrice: +form.entryPrice,
          exitPrice: form.exitPrice ? +form.exitPrice : null,
          qty: +form.qty,
          commission: form.commission ? +form.commission : 0,
          openedAt: form.openedAt ? new Date(form.openedAt).toISOString() : null,
          closedAt: form.closedAt ? new Date(form.closedAt).toISOString() : null,
          setupType: form.setupType || null,
          conviction: form.conviction ? +form.conviction : null,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save trade');
      }
      success('Trade logged successfully');
      setForm({ symbol: '', side: 'long', entryPrice: '', exitPrice: '', qty: '', commission: '', openedAt: new Date().toISOString().slice(0, 16), closedAt: '', setupType: '', conviction: '', notes: '' });
      onSaved?.();
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel trade-entry-panel">
      <button className="trade-entry-toggle" onClick={() => setExpanded(!expanded)}>
        <span>Log Trade</span>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {expanded && (
        <form className="trade-entry-form" onSubmit={handleSubmit}>
          <div className="trade-entry-row">
            <div className="profile-field">
              <label className="profile-label">Symbol</label>
              <input className="profile-input" value={form.symbol} onChange={e => update('symbol', e.target.value)} placeholder="AAPL" />
            </div>
            <div className="profile-field">
              <label className="profile-label">Side</label>
              <div className="trade-side-toggle">
                <button type="button" className={`trade-side-btn ${form.side === 'long' ? 'active long' : ''}`} onClick={() => update('side', 'long')}>Long</button>
                <button type="button" className={`trade-side-btn ${form.side === 'short' ? 'active short' : ''}`} onClick={() => update('side', 'short')}>Short</button>
              </div>
            </div>
            <div className="profile-field">
              <label className="profile-label">Entry Price</label>
              <input className="profile-input" type="number" step="0.01" value={form.entryPrice} onChange={e => update('entryPrice', e.target.value)} placeholder="0.00" />
            </div>
            <div className="profile-field">
              <label className="profile-label">Exit Price</label>
              <input className="profile-input" type="number" step="0.01" value={form.exitPrice} onChange={e => update('exitPrice', e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div className="trade-entry-row">
            <div className="profile-field">
              <label className="profile-label">Quantity</label>
              <input className="profile-input" type="number" value={form.qty} onChange={e => update('qty', e.target.value)} placeholder="100" />
            </div>
            <div className="profile-field">
              <label className="profile-label">Commission</label>
              <input className="profile-input" type="number" step="0.01" value={form.commission} onChange={e => update('commission', e.target.value)} placeholder="0.00" />
            </div>
            <div className="profile-field">
              <label className="profile-label">Opened At</label>
              <input className="profile-input" type="datetime-local" value={form.openedAt} onChange={e => update('openedAt', e.target.value)} />
            </div>
            <div className="profile-field">
              <label className="profile-label">Closed At</label>
              <input className="profile-input" type="datetime-local" value={form.closedAt} onChange={e => update('closedAt', e.target.value)} />
            </div>
          </div>

          <div className="trade-entry-row">
            <div className="profile-field">
              <label className="profile-label">Setup Type</label>
              <select className="profile-select" value={form.setupType} onChange={e => update('setupType', e.target.value)}>
                <option value="">—</option>
                {SETUP_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="profile-field">
              <label className="profile-label">Conviction (1-5)</label>
              <input className="profile-input" type="number" min="1" max="5" value={form.conviction} onChange={e => update('conviction', e.target.value)} placeholder="1-5" />
            </div>
            <div className="profile-field" style={{ flex: 2 }}>
              <label className="profile-label">Notes</label>
              <input className="profile-input" value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Trade notes..." />
            </div>
          </div>

          <div className="trade-entry-actions">
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Trade'}</button>
            {onClose && <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>}
          </div>
        </form>
      )}
    </div>
  );
}
