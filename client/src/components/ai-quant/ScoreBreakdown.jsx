import React, { useState } from 'react';

// Expandable score breakdown that shows every factor's contribution
export default function ScoreBreakdown({ breakdown, score }) {
  const [open, setOpen] = useState(false);
  if (!breakdown?.length) return null;

  return (
    <div className="aiq-score-bd">
      <button className="aiq-score-bd-toggle" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        title="Click to see score breakdown">
        <span className="aiq-score-bd-arrow">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="aiq-score-bd-popup" onClick={e => e.stopPropagation()}>
          <div className="aiq-score-bd-header">
            <span>Factor</span><span>Pts</span>
          </div>
          {breakdown.map((b, i) => (
            <div key={i} className="aiq-score-bd-row">
              <span className="aiq-score-bd-factor">{b.factor}</span>
              <span className="aiq-score-bd-value">{b.value}</span>
              <div className="aiq-score-bd-bar-wrap">
                <div className="aiq-score-bd-bar"
                  style={{ width: `${(b.pts / b.max) * 100}%`, background: b.pts >= b.max * 0.7 ? 'var(--accent-green)' : b.pts >= b.max * 0.4 ? 'var(--accent-blue)' : 'var(--accent-orange)' }} />
              </div>
              <span className="aiq-score-bd-pts">{b.pts}/{b.max}</span>
            </div>
          ))}
          <div className="aiq-score-bd-total">Total: {score}/100</div>
        </div>
      )}
    </div>
  );
}
