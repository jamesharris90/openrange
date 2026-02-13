import { useState } from 'react';
import { MessageSquareWarning, Send, X, Loader, Bot } from 'lucide-react';

export default function BiasChallenge({ ticker, onClose }) {
  const [thesis, setThesis] = useState('');
  const [direction, setDirection] = useState('long');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChallenge = async () => {
    if (!thesis.trim() || loading) return;
    setLoading(true);
    setResponse(null);

    const prompt = [
      `I want to go ${direction.toUpperCase()} on ${ticker}.`,
      `My thesis: ${thesis}`,
      '',
      'Challenge this thesis. Be the devil\'s advocate.',
      'List 3-5 specific counter-arguments with data points.',
      'End with a risk rating (Low / Medium / High) for this trade.',
      'Keep it concise and actionable.',
    ].join('\n');

    try {
      const r = await fetch('/api/ai-quant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, contextSource: 'scanner' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setResponse(data.answer);
    } catch (e) {
      setResponse(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="aiq-modal-overlay" onClick={onClose}>
      <div className="aiq-modal aiq-modal--challenge" onClick={e => e.stopPropagation()}>
        <div className="aiq-modal__header">
          <h3><MessageSquareWarning size={18} /> Bias Challenge: {ticker}</h3>
          <button className="aiq-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="aiq-modal__body">
          <div className="aiq-challenge-form">
            <div className="aiq-challenge-direction">
              <button className={`aiq-dir-btn ${direction === 'long' ? 'aiq-dir-btn--active-long' : ''}`} onClick={() => setDirection('long')}>Long ↑</button>
              <button className={`aiq-dir-btn ${direction === 'short' ? 'aiq-dir-btn--active-short' : ''}`} onClick={() => setDirection('short')}>Short ↓</button>
            </div>
            <textarea
              className="aiq-challenge-textarea"
              value={thesis}
              onChange={e => setThesis(e.target.value)}
              placeholder={`Why do you want to go ${direction} on ${ticker}? Enter your thesis…`}
              rows={3}
            />
            <button className="aiq-btn aiq-btn--warning" onClick={handleChallenge} disabled={loading || !thesis.trim()}>
              {loading ? <><Loader size={14} className="aiq-spin" /> Analyzing…</> : <><MessageSquareWarning size={14} /> Challenge My Thesis</>}
            </button>
          </div>

          {response && (
            <div className="aiq-challenge-response">
              <div className="aiq-challenge-response__icon"><Bot size={16} /></div>
              <div className="aiq-challenge-response__text">{response}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
