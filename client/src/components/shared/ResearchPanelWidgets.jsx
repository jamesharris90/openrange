import { useState, Component } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/* ── Error Boundary (catches render errors per-section) ── */
export class SectionErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return <div className="erp-empty" style={{ color: 'var(--accent-orange)' }}>Failed to render this section</div>;
    }
    return this.props.children;
  }
}

/* ── Safe number formatting helpers ── */
export const safeFix = (v, digits = 2) => { const n = Number(v); return isFinite(n) ? n.toFixed(digits) : null; };
export const safePercent = (v) => { const n = Number(v); return isFinite(n) ? `${n > 0 ? '+' : ''}${n}%` : null; };

/* ── Score Gauge (circular SVG + breakdown bars) ── */
const DEFAULT_MAX = {
  earningsTrack: 20, expectedMove: 15, liquidity: 15,
  shortInterest: 10, analystSentiment: 15, technicals: 15, newsMomentum: 10,
};
const DEFAULT_LABELS = {
  earningsTrack: 'Earnings', expectedMove: 'Exp. Move', liquidity: 'Liquidity',
  shortInterest: 'Short Int.', analystSentiment: 'Analysts', technicals: 'Technicals', newsMomentum: 'News',
};

export function ScoreGauge({ score = 0, breakdown, maxPerCategory, labels }) {
  const maxMap = maxPerCategory || DEFAULT_MAX;
  const labelMap = labels || DEFAULT_LABELS;

  const clampedScore = Math.max(0, Math.min(100, Number(score) || 0));
  const getColor = (s) => {
    if (s >= 75) return '#10b981';
    if (s >= 55) return '#eab308';
    if (s >= 35) return '#f59e0b';
    return '#ef4444';
  };
  const getLabel = (s) => {
    if (s >= 75) return 'Strong Setup';
    if (s >= 55) return 'Good Setup';
    if (s >= 35) return 'Fair Setup';
    return 'Weak Setup';
  };
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const progress = (clampedScore / 100) * circumference;
  const color = getColor(clampedScore);

  return (
    <div className="erp-score">
      <div className="erp-score__gauge">
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--border-color)" strokeWidth="6" />
          <circle cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${progress} ${circumference - progress}`}
            strokeDashoffset={circumference * 0.25}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.5s ease' }} />
          <text x="50" y="45" textAnchor="middle" fill={color} fontSize="22" fontWeight="700">{clampedScore}</text>
          <text x="50" y="60" textAnchor="middle" fill="var(--text-muted)" fontSize="9">/100</text>
        </svg>
      </div>
      <div className="erp-score__label" style={{ color }}>{getLabel(clampedScore)}</div>
      {breakdown && typeof breakdown === 'object' && (
        <div className="erp-score__breakdown">
          {Object.entries(breakdown).map(([key, val]) => {
            const numVal = Number(val) || 0;
            const maxVal = maxMap[key] || 20;
            return (
              <div key={key} className="erp-score__item">
                <span className="erp-score__item-label">{labelMap[key] || key}</span>
                <div className="erp-score__item-bar">
                  <div className="erp-score__item-fill"
                    style={{ width: `${Math.min(100, (numVal / maxVal) * 100)}%`, background: color }} />
                </div>
                <span className="erp-score__item-val">{numVal}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Mini Score Gauge (compact circular gauge with popover breakdown) ── */
export function MiniScoreGauge({ score = 0, label = 'Score', breakdown, maxPerCategory, labels, size = 84 }) {
  const [showPopover, setShowPopover] = useState(false);
  const maxMap = maxPerCategory || DEFAULT_MAX;
  const labelMap = labels || DEFAULT_LABELS;

  const clampedScore = Math.max(0, Math.min(100, Number(score) || 0));
  const getColor = (s) => {
    if (s >= 75) return '#10b981';
    if (s >= 55) return '#eab308';
    if (s >= 35) return '#f59e0b';
    return '#ef4444';
  };
  const radius = size * 0.38;
  const viewBox = size;
  const circumference = 2 * Math.PI * radius;
  const progress = (clampedScore / 100) * circumference;
  const color = getColor(clampedScore);
  const cx = viewBox / 2;
  const cy = viewBox / 2;

  return (
    <div className="mini-score-gauge" onMouseLeave={() => setShowPopover(false)}>
      <div className="mini-score-gauge__circle">
        <svg width={size} height={size} viewBox={`0 0 ${viewBox} ${viewBox}`}>
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--border-color)" strokeWidth="4" />
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke={color} strokeWidth="4"
            strokeDasharray={`${progress} ${circumference - progress}`}
            strokeDashoffset={circumference * 0.25}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.5s ease' }} />
          <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="central" fill={color} fontSize={size * 0.28} fontWeight="700">{clampedScore}</text>
          <text x={cx} y={cy + size * 0.18} textAnchor="middle" fill="var(--text-muted)" fontSize={size * 0.13}>/100</text>
        </svg>
        {breakdown && (
          <button className="mini-score-gauge__info" onClick={(e) => { e.stopPropagation(); setShowPopover(p => !p); }}
            onMouseEnter={() => setShowPopover(true)} title="Score breakdown">
            i
          </button>
        )}
      </div>
      <div className="mini-score-gauge__label">{label}</div>
      {showPopover && breakdown && typeof breakdown === 'object' && (
        <div className="mini-score-gauge__popover" onClick={e => e.stopPropagation()}>
          <div className="mini-score-gauge__popover-title">{label} Breakdown</div>
          {Object.entries(breakdown).map(([key, val]) => {
            const numVal = Number(val) || 0;
            const maxVal = maxMap[key] || 20;
            return (
              <div key={key} className="erp-score__item">
                <span className="erp-score__item-label">{labelMap[key] || key}</span>
                <div className="erp-score__item-bar">
                  <div className="erp-score__item-fill"
                    style={{ width: `${Math.min(100, (numVal / maxVal) * 100)}%`, background: color }} />
                </div>
                <span className="erp-score__item-val">{numVal}/{maxVal}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Collapsible section ── */
export function Section({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="erp-section">
      <button className="erp-section__toggle" onClick={() => setOpen(o => !o)} type="button">
        {Icon && <Icon size={16} />}
        <span>{title}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="erp-section__body">
          <SectionErrorBoundary>{children}</SectionErrorBoundary>
        </div>
      )}
    </div>
  );
}

/* ── Key-value stat row ── */
export function StatRow({ label, value, color }) {
  return (
    <div className="erp-stat-row">
      <span className="erp-stat-row__label">{label}</span>
      <span className="erp-stat-row__value" style={color ? { color } : undefined}>
        {value ?? '\u2014'}
      </span>
    </div>
  );
}

/* ── Loading skeleton ── */
export function LoadingSkeleton() {
  return (
    <div className="erp-loading">
      {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
        <div key={i} className="erp-skeleton" style={{ height: 18, width: `${50 + Math.random() * 50}%` }} />
      ))}
    </div>
  );
}
