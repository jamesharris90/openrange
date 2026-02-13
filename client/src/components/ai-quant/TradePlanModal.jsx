import { useState } from 'react';
import { X, Target, ArrowUpRight, ArrowDownRight, Copy, Check } from 'lucide-react';

export default function TradePlanModal({ plan, onClose }) {
  const [copied, setCopied] = useState(false);

  if (!plan) return null;

  const isLong = plan.direction === 'long';

  const handleCopy = () => {
    const text = [
      `Trade Plan: ${plan.ticker} (${plan.strategy?.toUpperCase()})`,
      `Direction: ${plan.direction?.toUpperCase()}`,
      `Entry: $${plan.entry}`,
      `Stop: $${plan.stop} (risk: $${plan.riskPerShare}/share)`,
      ...plan.targets.map(t => `Target ${t.label}: $${t.price} (${t.rr})`),
      `ATR: $${plan.atr} (${plan.atrPercent}%)`,
      plan.expectedMove ? `Expected Move: $${plan.expectedMove}` : '',
      '',
      ...plan.notes,
    ].filter(Boolean).join('\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="aiq-modal-overlay" onClick={onClose}>
      <div className="aiq-modal" onClick={e => e.stopPropagation()}>
        <div className="aiq-modal__header">
          <h3>
            <Target size={18} />
            Trade Plan: {plan.ticker}
          </h3>
          <div className="aiq-modal__header-actions">
            <button className="aiq-icon-btn" onClick={handleCopy} title="Copy to clipboard">
              {copied ? <Check size={16} color="var(--accent-green)" /> : <Copy size={16} />}
            </button>
            <button className="aiq-icon-btn" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="aiq-modal__body">
          {/* Direction Badge */}
          <div className={`aiq-plan-direction ${isLong ? 'aiq-plan-direction--long' : 'aiq-plan-direction--short'}`}>
            {isLong ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
            <span>{isLong ? 'LONG' : 'SHORT'}</span>
            <span className="aiq-plan-strategy">{plan.strategy?.toUpperCase()}</span>
          </div>

          {/* Entry / Stop / Risk */}
          <div className="aiq-plan-grid">
            <div className="aiq-plan-cell">
              <div className="aiq-plan-cell__label">Entry</div>
              <div className="aiq-plan-cell__value">${plan.entry}</div>
            </div>
            <div className="aiq-plan-cell aiq-plan-cell--stop">
              <div className="aiq-plan-cell__label">Stop Loss</div>
              <div className="aiq-plan-cell__value">${plan.stop}</div>
              <div className="aiq-plan-cell__sub">-${plan.riskPerShare}/share</div>
            </div>
            <div className="aiq-plan-cell">
              <div className="aiq-plan-cell__label">ATR</div>
              <div className="aiq-plan-cell__value">${plan.atr}</div>
              <div className="aiq-plan-cell__sub">{plan.atrPercent}%</div>
            </div>
          </div>

          {/* Targets */}
          <div className="aiq-plan-targets">
            <div className="aiq-plan-targets__title">Targets</div>
            {plan.targets.map(t => (
              <div key={t.label} className="aiq-plan-target">
                <span className="aiq-plan-target__label">{t.label}</span>
                <span className="aiq-plan-target__price">${t.price}</span>
                <span className="aiq-plan-target__rr">{t.rr}</span>
                <div className="aiq-plan-target__bar">
                  <div className="aiq-plan-target__fill" style={{ width: `${Math.min(100, parseInt(t.label) * 33)}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Position Size Calculator */}
          <PositionSizer riskPerShare={plan.riskPerShare} entry={plan.entry} />

          {/* Notes */}
          {plan.notes?.length > 0 && (
            <div className="aiq-plan-notes">
              <div className="aiq-plan-notes__title">Strategy Notes</div>
              <ul>
                {plan.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PositionSizer({ riskPerShare, entry }) {
  const [accountRisk, setAccountRisk] = useState('');

  const riskDollars = parseFloat(accountRisk) || 0;
  const shares = riskPerShare > 0 ? Math.floor(riskDollars / riskPerShare) : 0;
  const position = shares * (entry || 0);

  return (
    <div className="aiq-position-sizer">
      <div className="aiq-position-sizer__title">Position Sizer</div>
      <div className="aiq-position-sizer__row">
        <label>Risk $ per trade:</label>
        <input
          type="number"
          value={accountRisk}
          onChange={e => setAccountRisk(e.target.value)}
          placeholder="e.g. 200"
          className="aiq-input"
        />
      </div>
      {shares > 0 && (
        <div className="aiq-position-sizer__result">
          <span>{shares} shares</span>
          <span>≈ ${position.toLocaleString()} position</span>
        </div>
      )}
    </div>
  );
}
