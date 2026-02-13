import React from 'react';

// Scanner confirmation badges — shows which other scanners also flag this ticker
const BADGE_DEFS = {
  ORB:  { label: 'ORB',  color: '#3b82f6', tip: 'Found in ORB Intraday scanner' },
  EARN: { label: 'EARN', color: '#f59e0b', tip: 'Found in Earnings Momentum scanner' },
  CONT: { label: 'CONT', color: '#8b5cf6', tip: 'Found in Continuation scanner' },
};

export default function ConfirmationBadges({ badges }) {
  if (!badges?.length) return <span className="aiq-conf-none">—</span>;
  return (
    <span className="aiq-conf-badges">
      {badges.map(b => {
        const def = BADGE_DEFS[b] || { label: b, color: '#666', tip: b };
        return (
          <span key={b} className="aiq-conf-badge" title={def.tip}
            style={{ borderColor: def.color, color: def.color }}>{def.label}</span>
        );
      })}
    </span>
  );
}

export function ConfidenceTierBadge({ tier }) {
  if (!tier) return null;
  return (
    <span className="aiq-tier-badge" style={{ background: tier.bg, color: tier.color, borderColor: tier.color }}>
      {tier.tier}
    </span>
  );
}

export function DataQualityDot({ quality }) {
  const map = { high: { color: 'var(--accent-green)', label: 'High' }, medium: { color: 'var(--accent-orange)', label: 'Med' }, low: { color: 'var(--accent-red)', label: 'Low' } };
  const q = map[quality] || map.low;
  return <span className="aiq-dq-dot" title={`Data quality: ${q.label}`} style={{ background: q.color }} />;
}
