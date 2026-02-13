import { useState, useEffect } from 'react';
import { X, AlertTriangle, Shield, Info, TrendingUp, TrendingDown, Activity, Star } from 'lucide-react';
import { computeRiskFlags, getScoreColor, getScoreLabel, buildRankExplanation } from './scoring';
import { ConfidenceTierBadge, DataQualityDot } from './ConfirmationBadges';
import ScoreBreakdown from './ScoreBreakdown';

const FLAG_STYLES = {
  high: { color: 'var(--accent-red)', icon: AlertTriangle },
  medium: { color: 'var(--accent-orange)', icon: Shield },
  low: { color: 'var(--accent-blue)', icon: Info },
};

export default function DeepDivePanel({ ticker, onClose, onBuildPlan, activeStrategy, rowData, watchlist, addToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/earnings-research/${ticker}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (!cancelled) { setData(d); setError(null); } })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (!ticker) return null;

  const riskFlags = data ? computeRiskFlags(data) : [];
  const rankReasons = rowData ? buildRankExplanation(rowData, activeStrategy) : [];
  const inWL = watchlist?.has(ticker);

  const handleAddWL = () => {
    watchlist?.add(ticker, `aiq-${activeStrategy}`);
    addToast?.(`${ticker} added to watchlist`, 'success');
  };
  const handleRemoveWL = () => {
    watchlist?.remove(ticker);
    addToast?.(`${ticker} removed from watchlist`, 'info');
  };

  // Safe formatting helpers that handle null/missing values
  const fmtCurrency = (v) => v != null ? `$${Number(v).toFixed(2)}` : '—';
  const fmtMktCap = (v) => {
    if (!v) return '—';
    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v}`;
  };
  const fmtVol = (n) => {
    if (!n) return '—';
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return String(n);
  };

  return (
    <div className="aiq-panel aiq-deep-dive">
      <div className="aiq-panel__header">
        <h3>{ticker} Deep Dive</h3>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button className="aiq-btn aiq-btn--sm" onClick={inWL ? handleRemoveWL : handleAddWL}
            title={inWL ? 'Remove from watchlist' : 'Add to watchlist'}>
            <Star size={13} fill={inWL ? 'var(--accent-orange)' : 'none'} color={inWL ? 'var(--accent-orange)' : 'currentColor'} />
            {inWL ? 'In WL' : '+ WL'}
          </button>
          <button className="aiq-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
      </div>

      {loading && <div className="aiq-panel__loading">Loading deep dive…</div>}
      {error && <div className="aiq-panel__error">Error: {error}</div>}

      {data && (
        <div className="aiq-dd-content">
          {/* Price Header + Tier */}
          <div className="aiq-dd-price-header">
            <span className="aiq-dd-price">{fmtCurrency(data.price)}</span>
            <span className="aiq-dd-name">{data.name}</span>
            {rowData && <ConfidenceTierBadge tier={rowData.confidenceTier} />}
            {rowData && <DataQualityDot quality={rowData.dataQuality} />}
          </div>

          {/* Why Is This Ranked? — Specific, non-AI explanation */}
          {rowData && (
            <div className="aiq-dd-section aiq-dd-rank-why">
              <div className="aiq-dd-section__title">📊 Why Is This Ranked?</div>
              <div className="aiq-dd-rank-score">
                <ScoreBreakdown breakdown={rowData.breakdown} score={rowData.score} />
                <span style={{ color: getScoreColor(rowData.score), fontWeight: 600 }}>/100 {getScoreLabel(rowData.score)}</span>
              </div>
              <ul className="aiq-rank-reasons">
                {rankReasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              {rowData.confirmBadges?.length > 0 && (
                <div className="aiq-rank-confirmations">
                  Also found in: {rowData.confirmBadges.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* Setup Score */}
          {data.setupScore && (
            <div className="aiq-dd-score-box">
              <div className="aiq-dd-score-label">Setup Score</div>
              <div className="aiq-dd-score-value" style={{ color: getScoreColor(data.setupScore.score) }}>
                {data.setupScore.score}
                <span className="aiq-dd-score-tag">{getScoreLabel(data.setupScore.score)}</span>
              </div>
              <div className="aiq-dd-score-bar">
                <div className="aiq-dd-score-fill" style={{ width: `${data.setupScore.score}%`, background: getScoreColor(data.setupScore.score) }} />
              </div>
            </div>
          )}

          {/* Risk Flags */}
          {riskFlags.length > 0 && (
            <div className="aiq-dd-section">
              <div className="aiq-dd-section__title">⚠ Risk Flags</div>
              <div className="aiq-risk-flags">
                {riskFlags.map((flag, i) => {
                  const { color, icon: FlagIcon } = FLAG_STYLES[flag.level] || FLAG_STYLES.low;
                  return (
                    <div key={i} className="aiq-risk-flag" style={{ borderLeftColor: color }}>
                      <FlagIcon size={14} color={color} />
                      <span>{flag.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Company Snapshot */}
          {data.company && (
            <div className="aiq-dd-section">
              <div className="aiq-dd-section__title">Company</div>
              <div className="aiq-dd-grid">
                <StatRow label="Sector" value={data.company.sector || '—'} />
                <StatRow label="Industry" value={data.company.industry || '—'} />
                <StatRow label="Market Cap" value={fmtMktCap(data.company.marketCap)} />
                <StatRow label="Avg Volume" value={fmtVol(data.company.avgVolume)} />
                <StatRow label="Float" value={data.company.floatShares ? fmtVol(data.company.floatShares) : '—'} />
                <StatRow label="Short %" value={data.company.shortPercentOfFloat ? `${data.company.shortPercentOfFloat}%` : '—'} />
                <StatRow label="Beta" value={data.company.beta?.toFixed(2) || '—'} />
              </div>
            </div>
          )}

          {/* Technicals */}
          {data.technicals?.available && (
            <div className="aiq-dd-section">
              <div className="aiq-dd-section__title">Technicals</div>
              <div className="aiq-dd-grid">
                <StatRow label="Trend" value={data.technicals.trend} valueColor={data.technicals.trend === 'bullish' ? 'var(--accent-green)' : data.technicals.trend === 'bearish' ? 'var(--accent-red)' : undefined} />
                <StatRow label="RSI(14)" value={data.technicals.rsi?.toFixed(1) || '—'} />
                <StatRow label="ATR(14)" value={data.technicals.atr ? `$${data.technicals.atr.toFixed(2)} (${data.technicals.atrPercent}%)` : '—'} />
                <StatRow label="vs 20-SMA" value={data.technicals.distSMA20 != null ? `${data.technicals.distSMA20 > 0 ? '+' : ''}${data.technicals.distSMA20}%` : '—'} />
                <StatRow label="vs 50-SMA" value={data.technicals.distSMA50 != null ? `${data.technicals.distSMA50 > 0 ? '+' : ''}${data.technicals.distSMA50}%` : '—'} />
                <StatRow label="52W Range" value={data.technicals.low52w && data.technicals.high52w ? `$${data.technicals.low52w} – $${data.technicals.high52w}` : '—'} />
              </div>
            </div>
          )}

          {/* Expected Move */}
          {data.expectedMove?.available && (
            <div className="aiq-dd-section">
              <div className="aiq-dd-section__title">Expected Move</div>
              <div className="aiq-dd-grid">
                <StatRow label="Straddle" value={`$${data.expectedMove.straddle}`} />
                <StatRow label="Exp Move" value={`±$${data.expectedMove.expectedMove} (${data.expectedMove.expectedMovePercent}%)`} />
                <StatRow label="IV" value={data.expectedMove.ivPercent ? `${data.expectedMove.ivPercent}%` : '—'} />
                <StatRow label="Range" value={`$${data.expectedMove.rangeLow} – $${data.expectedMove.rangeHigh}`} />
              </div>
            </div>
          )}

          {/* Earnings */}
          {data.earnings && (
            <div className="aiq-dd-section">
              <div className="aiq-dd-section__title">Earnings</div>
              <div className="aiq-dd-grid">
                <StatRow label="Next Date" value={data.earnings.earningsDate || '—'} />
                <StatRow label="EPS Est" value={data.earnings.epsEstimate != null ? `$${data.earnings.epsEstimate.toFixed(2)}` : '—'} />
                <StatRow label="Beats" value={data.earnings.beatsInLast4 != null ? `${data.earnings.beatsInLast4}/4` : '—'} />
                <StatRow label="Rev Growth" value={data.earnings.revenueGrowth != null ? `${data.earnings.revenueGrowth}%` : '—'} />
              </div>
            </div>
          )}

          {/* Sentiment */}
          {data.sentiment && (
            <div className="aiq-dd-section">
              <div className="aiq-dd-section__title">Sentiment</div>
              <div className="aiq-dd-grid">
                <StatRow label="Rating" value={data.sentiment.recommendationKey || '—'} />
                <StatRow label="# Analysts" value={data.sentiment.numberOfAnalysts ?? '—'} />
                <StatRow label="Target" value={data.sentiment.targetMeanPrice ? fmtCurrency(data.sentiment.targetMeanPrice) : '—'} />
                <StatRow label="Upside" value={data.sentiment.targetVsPrice != null ? `${data.sentiment.targetVsPrice > 0 ? '+' : ''}${data.sentiment.targetVsPrice}%` : '—'}
                  valueColor={data.sentiment.targetVsPrice > 0 ? 'var(--accent-green)' : data.sentiment.targetVsPrice < 0 ? 'var(--accent-red)' : undefined} />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="aiq-dd-actions">
            <button className="aiq-btn aiq-btn--primary" onClick={() => onBuildPlan?.({ ticker, strategy: activeStrategy, data })}>
              <Activity size={14} /> Build Trade Plan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value, valueColor }) {
  return (
    <div className="aiq-stat-row">
      <span className="aiq-stat-row__label">{label}</span>
      <span className="aiq-stat-row__value" style={valueColor ? { color: valueColor } : undefined}>{value}</span>
    </div>
  );
}
