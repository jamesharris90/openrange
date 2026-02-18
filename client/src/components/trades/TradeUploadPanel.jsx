import { useState, useRef } from 'react';
import { Upload, AlertTriangle, Check, X, FileText, ClipboardPaste } from 'lucide-react';
import { authFetch } from '../../utils/api';
import { useToast } from '../../context/ToastContext';

const SIDE_OPTIONS = ['long', 'short'];

export default function TradeUploadPanel({ onSaved, onClose }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [step, setStep] = useState('input'); // input | review | saving | done
  const [inputMode, setInputMode] = useState('file'); // file | paste
  const [pasteText, setPasteText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [trades, setTrades] = useState([]);
  const [scope, setScope] = useState('demo');
  const [error, setError] = useState(null);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await authFetch('/api/trades/upload', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      const data = await res.json();
      setParsed(data);
      setTrades(data.trades.map(t => ({ ...t, include: true })));
      setStep('review');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handlePasteSubmit = async () => {
    if (!pasteText.trim()) {
      setError('Please paste some text first.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const res = await authFetch('/api/trades/parse-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Parse failed');
      }
      const data = await res.json();
      setParsed(data);
      setTrades(data.trades.map(t => ({ ...t, include: true })));
      setStep('review');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const updateTrade = (idx, field, value) => {
    setTrades(prev => prev.map((t, i) => {
      if (i !== idx) return t;
      const updated = { ...t, [field]: value };
      const missing = [];
      if (!updated.ticker) missing.push('ticker');
      if (!updated.qty) missing.push('quantity');
      if (!updated.entryPrice) missing.push('entryPrice');
      if (!updated.exitPrice) missing.push('exitPrice');
      if (!updated.openedAt) missing.push('openedAt');
      if (!updated.closedAt) missing.push('closedAt');
      updated.missing = missing;
      updated.status = updated.qty && updated.entryPrice && updated.exitPrice ? 'complete' : 'incomplete';
      return updated;
    }));
  };

  const toggleInclude = (idx) => {
    setTrades(prev => prev.map((t, i) => i === idx ? { ...t, include: !t.include } : t));
  };

  const handleConfirm = async () => {
    const toSave = trades.filter(t => t.include).map(t => ({
      ticker: t.ticker,
      side: t.side,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      qty: t.qty,
      pnlDollar: t.pnlDollar,
      pnlPercent: t.pnlPercent,
      commission: t.commission,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
    }));

    if (toSave.length === 0) {
      toast.warn('No trades selected to save.');
      return;
    }

    setStep('saving');
    try {
      const res = await authFetch('/api/trades/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: toSave, scope }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Save failed');
      }
      const result = await res.json();
      const scopeLabel = scope === 'user' ? 'your account' : 'demo data';
      toast.success(`Saved ${result.saved} trades to ${scopeLabel}. ${result.skipped} skipped.`);
      setStep('done');
      onSaved?.();
    } catch (err) {
      setError(err.message);
      setStep('review');
    }
  };

  const reset = () => {
    setStep('input');
    setParsed(null);
    setTrades([]);
    setError(null);
    setPasteText('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const includedCount = trades.filter(t => t.include).length;
  const incompleteCount = trades.filter(t => t.include && t.status === 'incomplete').length;

  return (
    <div className="panel upload-panel">
      <div className="panel-header">
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Upload size={18} /> Import Trades
        </h3>
        <button className="btn-icon" onClick={onClose}><X size={16} /></button>
      </div>

      <p className="muted" style={{ margin: '8px 0 12px' }}>
        Upload a file (PDF, CSV, TXT) or paste execution text. Choose where to save below.
      </p>

      {/* Scope selector */}
      <div className="upload-scope-row">
        <span style={{ fontSize: 13 }}>Save to:</span>
        <div className="scope-toggle">
          <button className={`scope-btn${scope === 'demo' ? ' active' : ''}`} onClick={() => setScope('demo')}>Demo Data</button>
          <button className={`scope-btn${scope === 'user' ? ' active' : ''}`} onClick={() => setScope('user')}>My Account</button>
        </div>
      </div>

      {error && (
        <div className="upload-error">
          <AlertTriangle size={14} /> {error}
          <button className="btn-icon" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {step === 'input' && (
        <>
          {/* Input mode tabs */}
          <div className="upload-mode-tabs">
            <button className={`upload-mode-tab${inputMode === 'file' ? ' active' : ''}`} onClick={() => setInputMode('file')}>
              <FileText size={14} /> Upload File
            </button>
            <button className={`upload-mode-tab${inputMode === 'paste' ? ' active' : ''}`} onClick={() => setInputMode('paste')}>
              <ClipboardPaste size={14} /> Paste Text
            </button>
          </div>

          {inputMode === 'file' && (
            <div className="upload-dropzone" onClick={() => fileRef.current?.click()}>
              <FileText size={32} className="muted" />
              <p>{uploading ? 'Uploading and parsing...' : 'Click to select a file (PDF, Excel, CSV, TXT)'}</p>
              <span className="muted" style={{ fontSize: 11 }}>Supports Saxo reports (Excel/PDF), CSV with headers, and text files</span>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.csv,.txt,.text,.xls,.xlsx,application/pdf,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
                disabled={uploading}
              />
            </div>
          )}

          {inputMode === 'paste' && (
            <div className="upload-paste-area">
              <textarea
                className="upload-textarea"
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={"Paste Saxo execution log, CSV data, or trade text here...\n\nExample formats:\n• Saxo: Position 123: Share trade executed to Buy 2 FSLY:xnas @ 16.92, cost 0.03...\n• CSV: ticker,side,qty,entry,exit,pnl\\nAAPL,long,10,150.00,155.00,50.00"}
                rows={10}
                disabled={uploading}
              />
              <button
                className="btn-primary"
                onClick={handlePasteSubmit}
                disabled={uploading || !pasteText.trim()}
                style={{ marginTop: 8 }}
              >
                {uploading ? 'Parsing...' : 'Parse Text'}
              </button>
            </div>
          )}
        </>
      )}

      {step === 'review' && parsed && (
        <>
          {parsed.warnings.length > 0 && (
            <div className="upload-warnings">
              {parsed.warnings.map((w, i) => (
                <div key={i} className="upload-warning-item">
                  <AlertTriangle size={14} /> {w}
                </div>
              ))}
            </div>
          )}

          <div className="upload-summary">
            <span>{parsed.summary.tradeCount} trades found</span>
            <span className="accent-green">{parsed.summary.completeCount} complete</span>
            <span className="accent-red">{parsed.summary.incompleteCount} need attention</span>
            {parsed.summary.totalPnl != null && (
              <span style={{ color: parsed.summary.totalPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                Total: {parsed.summary.totalPnl >= 0 ? '+' : ''}{parsed.summary.totalPnl.toFixed(2)}
              </span>
            )}
          </div>

          <div className="upload-table-wrap">
            <table className="upload-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Ticker</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>P&L</th>
                  <th>Commission</th>
                  <th>Opened</th>
                  <th>Closed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, idx) => (
                  <tr key={idx} className={!t.include ? 'row-excluded' : t.status === 'incomplete' ? 'row-incomplete' : ''}>
                    <td>
                      <input type="checkbox" checked={t.include} onChange={() => toggleInclude(idx)} />
                    </td>
                    <td>
                      <input
                        className={`upload-input${t.missing.includes('ticker') ? ' input-missing' : ''}`}
                        value={t.ticker}
                        onChange={e => updateTrade(idx, 'ticker', e.target.value.toUpperCase())}
                        placeholder="TICK"
                        style={{ width: 64 }}
                      />
                    </td>
                    <td>
                      <select className="upload-input" value={t.side} onChange={e => updateTrade(idx, 'side', e.target.value)}>
                        {SIDE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        className={`upload-input${t.missing.includes('quantity') ? ' input-missing' : ''}`}
                        type="number"
                        value={t.qty ?? ''}
                        onChange={e => updateTrade(idx, 'qty', e.target.value ? +e.target.value : null)}
                        placeholder="—"
                        style={{ width: 56 }}
                      />
                    </td>
                    <td>
                      <input
                        className={`upload-input${t.missing.includes('entryPrice') ? ' input-missing' : ''}`}
                        type="number"
                        step="0.01"
                        value={t.entryPrice ?? ''}
                        onChange={e => updateTrade(idx, 'entryPrice', e.target.value ? +e.target.value : null)}
                        placeholder="—"
                        style={{ width: 72 }}
                      />
                    </td>
                    <td>
                      <input
                        className={`upload-input${t.missing.includes('exitPrice') ? ' input-missing' : ''}`}
                        type="number"
                        step="0.01"
                        value={t.exitPrice ?? ''}
                        onChange={e => updateTrade(idx, 'exitPrice', e.target.value ? +e.target.value : null)}
                        placeholder="—"
                        style={{ width: 72 }}
                      />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {t.pnlDollar != null ? (
                        <span style={{ color: t.pnlDollar >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                          {t.pnlDollar >= 0 ? '+' : ''}{(+t.pnlDollar).toFixed(2)}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-muted)' }}>
                      {t.commission != null ? t.commission.toFixed(2) : '—'}
                    </td>
                    <td>
                      <input
                        className={`upload-input${t.missing.includes('openedAt') ? ' input-missing' : ''}`}
                        type="datetime-local"
                        value={formatDateTimeLocal(t.openedAt)}
                        onChange={e => updateTrade(idx, 'openedAt', e.target.value || null)}
                        style={{ width: 140 }}
                      />
                    </td>
                    <td>
                      <input
                        className={`upload-input${t.missing.includes('closedAt') ? ' input-missing' : ''}`}
                        type="datetime-local"
                        value={formatDateTimeLocal(t.closedAt)}
                        onChange={e => updateTrade(idx, 'closedAt', e.target.value || null)}
                        style={{ width: 140 }}
                      />
                    </td>
                    <td>
                      {t.status === 'complete' ? (
                        <span className="badge badge-green"><Check size={12} /> OK</span>
                      ) : (
                        <span className="badge badge-yellow"><AlertTriangle size={12} /> {t.missing.length}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="upload-actions">
            <button className="btn-secondary" onClick={reset}>Start Over</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {incompleteCount > 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {incompleteCount} incomplete
                </span>
              )}
              <button className="btn-primary" onClick={handleConfirm} disabled={includedCount === 0}>
                Save {includedCount} Trade{includedCount !== 1 ? 's' : ''} to {scope === 'user' ? 'My Account' : 'Demo'}
              </button>
            </div>
          </div>
        </>
      )}

      {step === 'saving' && (
        <div className="muted" style={{ padding: 24, textAlign: 'center' }}>Saving trades...</div>
      )}

      {step === 'done' && (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Check size={32} style={{ color: 'var(--accent-green)' }} />
          <p>Trades saved successfully.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn-secondary" onClick={reset}>Import More</button>
            <button className="btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDateTimeLocal(val) {
  if (!val) return '';
  // Handle ISO or "YYYY-MM-DDTHH:MM:SS" → "YYYY-MM-DDTHH:MM"
  const str = typeof val === 'string' ? val : '';
  if (str.includes('T')) return str.slice(0, 16);
  if (str.length === 10) return str + 'T00:00'; // date only
  return str;
}
