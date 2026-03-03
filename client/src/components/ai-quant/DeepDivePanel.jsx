import { useState, useEffect, useMemo } from 'react';
import { X, AlertTriangle, Shield, Info, TrendingUp, CheckCircle, Activity, Star, MessageSquareWarning } from 'lucide-react';
import { computeRiskFlags, computeUnifiedScore, computeCatalystDetail, getScoreColor, getScoreLabel } from './scoring';
import { ConfidenceTierBadge, DataQualityDot } from './ConfirmationBadges';
import { MiniScoreGauge } from '../shared/ResearchPanelWidgets';

const FLAG_STYLES = {
  high: { color: 'var(--accent-red)', icon: AlertTriangle },
  medium: { color: 'var(--accent-orange)', icon: Shield },
  low: { color: 'var(--accent-blue)', icon: Info },
  positive: { color: 'var(--accent-green)', icon: CheckCircle },
};

const STRATEGY_LABELS = { orb: 'ORB Intraday', earnings: 'Earnings Momentum', continuation: 'Multi-Day Continuation' };

const TOOLTIPS = {
  float: 'Low float (<20M) = higher volatility, wider spreads. High float = more stable price action.',
  short: '>20% = potential short squeeze setup. >10% = elevated, watch for covering rallies.',
  iv: 'High IV = expensive options, large expected moves. Post-earnings IV typically drops 30-50% (crush).',
  upside: 'Analyst target consensus vs current price. >20% = strong bullish signal.',
  beta: '>1.5 = moves 50% more than market. <0.5 = defensive, less volatile.',
  rsi: '>70 = overbought, pullback risk. <30 = oversold, bounce potential. 50 = neutral.',
  atr: 'Average True Range over 14 days. Higher = bigger daily swings, wider stops needed.',
};

const RATING_MAP = {
  strong_buy: { label: 'Strong Buy', color: 'var(--accent-green)' },
  buy: { label: 'Buy', color: 'var(--accent-green)' },
  hold: { label: 'Hold', color: 'var(--accent-orange)' },
  sell: { label: 'Sell', color: 'var(--accent-red)' },
  strong_sell: { label: 'Strong Sell', color: 'var(--accent-red)' },
  underperform: { label: 'Underperform', color: 'var(--accent-red)' },
  outperform: { label: 'Outperform', color: 'var(--accent-green)' },
};

const PERF_KEYS = [
  { key: 'Perf Week', label: '1W' },
  { key: 'Perf Month', label: '1M' },
  { key: 'Perf Quarter', label: '3M' },
  { key: 'Perf Half Y', label: '6M' },
  { key: 'Perf YTD', label: 'YTD' },
  { key: 'Perf Year', label: '1Y' },
];

function fmtEarningsDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

function fmtRating(key) {
  if (!key) return { label: '—', color: undefined };
  const mapped = RATING_MAP[key.toLowerCase().replace(/\s+/g, '_')];
  return mapped || { label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), color: undefined };
}

export default function DeepDivePanel({ ticker, onClose, onBuildPlan, activeStrategy, rowData, watchlist, addToast, onChallengeBias }) {
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

  const unified = useMemo(() => {
    if (!rowData || !data) return null;
    return computeUnifiedScore(rowData, data, activeStrategy);
  }, [rowData, data, activeStrategy]);

  const riskFlags = useMemo(() => {
    return data ? computeRiskFlags(data, activeStrategy) : [];
  }, [data, activeStrategy]);

  const catalyst = useMemo(() => {
    return data ? computeCatalystDetail(data, activeStrategy, rowData) : null;
  }, [data, activeStrategy, rowData]);

  if (!ticker) return null;

  const inWL = watchlist?.has(ticker);
  const handleAddWL = () => { watchlist?.add(ticker, `aiq-${activeStrategy}`); addToast?.(`${ticker} added to watchlist`, 'success'); };
  const handleRemoveWL = () => { watchlist?.remove(ticker); addToast?.(`${ticker} removed from watchlist`, 'info'); };

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

  // Strategy Score breakdown (from row data)
  const strategyBreakdown = rowData?.breakdown && typeof rowData.breakdown === 'object'
    ? Object.fromEntries(Object.entries(rowData.breakdown).map(([k, v]) => [k, typeof v === 'object' ? v.pts : v]))
    : null;
  const strategyMaxMap = rowData?.breakdown && typeof rowData.breakdown === 'object'
    ? Object.fromEntries(Object.entries(rowData.breakdown).map(([k, v]) => [k, typeof v === 'object' ? v.max : 20]))
    : {};

  // Setup Score (from earnings-research API)
  const SETUP_MAX = {
    earningsTrack: 20, expectedMove: 15, liquidity: 15,
    shortInterest: 10, analystSentiment: 15, technicals: 15, newsMomentum: 10,
  };
  const SETUP_LABELS = {
    earningsTrack: 'Earnings', expectedMove: 'Exp. Move', liquidity: 'Liquidity',
    shortInterest: 'Short Int.', analystSentiment: 'Analysts', technicals: 'Technicals', newsMomentum: 'News',
  };
  const setupScore = data?.setupScore?.score ?? null;
  const setupBreakdown = data?.setupScore?.breakdown ?? null;

  // Catalyst Score (normalized to 0-100)
  const catalystScore = catalyst ? Math.round((catalyst.score / catalyst.max) * 100) : null;
  const catalystBreakdown = catalyst?.breakdown
    ? Object.fromEntries(catalyst.breakdown.map(b => [b.factor, b.pts]))
    : null;
  const catalystMaxMap = catalyst?.breakdown
    ? Object.fromEntries(catalyst.breakdown.map(b => [b.factor, b.max]))
    : {};
  const catalystLabels = catalyst?.breakdown
    ? Object.fromEntries(catalyst.breakdown.map(b => [b.factor, b.factor]))
    : {};

  const warningFlags = riskFlags.filter(f => f.level !== 'positive');
  const bullishSignals = riskFlags.filter(f => f.level === 'positive');

  // Performance pills from Finviz row data (ORB and continuation modules)
  const perfData = (activeStrategy === 'orb' || activeStrategy === 'continuation') && rowData
    ? PERF_KEYS.map(({ key, label }) => {
        const raw = rowData[key];
        if (raw == null || raw === '') return null;
        const val = typeof raw === 'string' ? parseFloat(raw.replace('%', '')) : Number(raw);
        if (isNaN(val)) return null;
        return { label, val };
      }).filter(Boolean)
    : [];

  // 52W range slider data
  const low52w = data?.technicals?.low52w;
  const high52w = data?.technicals?.high52w;
  const price = data?.price;
  const has52wRange = low52w != null && high52w != null && price != null && high52w > low52w;
  const rangePct = has52wRange ? Math.min(100, Math.max(0, ((price - low52w) / (high52w - low52w)) * 100)) : 0;

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

          {/* Three Score Gauges */}
          <div className="aiq-dd-scores-row">
            {rowData && (
              <MiniScoreGauge
                score={rowData.score || 0}
                label="Strategy"
                breakdown={strategyBreakdown}
                maxPerCategory={strategyMaxMap}
                labels={strategyMaxMap} /* keys are already descriptive */
              />
            )}
            {setupScore != null && (
              <MiniScoreGauge
                score={setupScore}
                label="Setup"
                breakdown={setupBreakdown}
                maxPerCategory={SETUP_MAX}
                labels={SETUP_LABELS}
              />
            )}
            {catalystScore != null && (
              <MiniScoreGauge
                score={catalystScore}
                label="Catalyst"
                breakdown={catalystBreakdown}
                maxPerCategory={catalystMaxMap}
                labels={catalystLabels}
              />
            )}
          </div>

          {/* Strategy Context */}
          {rowData && (
            <div className="aiq-dd-strategy-context">
              <span className="aiq-dd-strategy-label">{STRATEGY_LABELS[activeStrategy] || activeStrategy}</span>
              {rowData.confirmBadges?.length > 0 && (
                <span className="aiq-dd-confirmations">
                  Also in: {rowData.confirmBadges.join(', ')}
                </span>
              )}
            </div>
          )}

          {/* Performance Row */}
          {perfData.length > 0 && (
            <div className="aiq-dd-perf-row">
              {perfData.map((p, i) => (
                <span key={i} className="aiq-dd-perf-pill" style={{
                  color: p.val > 0 ? 'var(--accent-green)' : p.val < 0 ? 'var(--accent-red)' : 'var(--text-muted)',
                  borderColor: p.val > 0 ? 'var(--accent-green)' : p.val < 0 ? 'var(--accent-red)' : 'var(--border-color)'
                }}>
                  <span className="aiq-dd-perf-pill__label">{p.label}</span>
                  <span className="aiq-dd-perf-pill__value">{p.val > 0 ? '+' : ''}{p.val.toFixed(1)}%</span>
                </span>
              ))}
            </div>
          )}

          {/* Bullish Signals */}
          {bullishSignals.length > 0 && (
            <div className="aiq-dd-section">
              <div className="aiq-dd-section__title" style={{ color: 'var(--accent-green)' }}>
                <TrendingUp size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                Bullish Signals
              </div>
              <div className="aiq-risk-flags">
                {bullishSignals.map((flag, i) => {
                  const { color, icon: FlagIcon } = FLAG_STYLES.positive;
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

          {/* Risk Flags */}
          {warningFlags.length > 0 && (
            <div className="aiq-dd-section">
              <div className="aiq-dd-section__title">Risk Flags</div>
              <div className="aiq-risk-flags">
                {warningFlags.map((flag, i) => {
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
                <StatRow label="Float" value={data.company.floatShares ? fmtVol(data.company.floatShares) : '—'}
                  tooltip={TOOLTIPS.float} />
                <StatRow label="Short %" value={data.company.shortPercentOfFloat ? `${data.company.shortPercentOfFloat}%` : '—'}
                  tooltip={TOOLTIPS.short} />
                <StatRow label="Beta" value={data.company.beta?.toFixed(2) || '—'}
                  tooltip={TOOLTIPS.beta} />
              </div>
            </div>
          )}

          {/* Technicals */}
          {data.technicals?.available && (
            <div className="aiq-dd-section">
              <div className="aiq-dd-section__title">Technicals</div>
              <div className="aiq-dd-grid">
                <StatRow label="Trend" value={data.technicals.trend} valueColor={data.technicals.trend === 'bullish' ? 'var(--accent-green)' : data.technicals.trend === 'bearish' ? 'var(--accent-red)' : undefined} />
                <StatRow label="RSI(14)" value={data.technicals.rsi?.toFixed(1) || '—'}
                  tooltip={TOOLTIPS.rsi} />
                <StatRow label="ATR(14)" value={data.technicals.atr ? `$${data.technicals.atr.toFixed(2)} (${data.technicals.atrPercent}%)` : '—'}
                  tooltip={TOOLTIPS.atr} />
                <StatRow label="vs 20-SMA" value={data.technicals.distSMA20 != null ? `${data.technicals.distSMA20 > 0 ? '+' : ''}${data.technicals.distSMA20}%` : '—'} />
                <StatRow label="vs 50-SMA" value={data.technicals.distSMA50 != null ? `${data.technicals.distSMA50 > 0 ? '+' : ''}${data.technicals.distSMA50}%` : '—'} />
              </div>
              {/* 52W Range Slider */}
              {has52wRange && (
                <div className="aiq-dd-52w-slider">
                  <div className="aiq-dd-52w-labels">
                    <span>${low52w.toFixed(2)}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>52W Range</span>
                    <span>${high52w.toFixed(2)}</span>
                  </div>
                  <div className="aiq-dd-52w-track">
                    <div className="aiq-dd-52w-dot" style={{ left: `${rangePct}%` }}
                      title={`$${price.toFixed(2)} (${rangePct.toFixed(0)}th percentile)`}>
                      <span className="aiq-dd-52w-price">${price.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Expected Move */}
          {data.expectedMove?.available && (
            <div className="aiq-dd-section">
              <div className="aiq-dd-section__title">Expected Move</div>
              <div className="aiq-dd-grid">
                <StatRow label="Straddle" value={`$${data.expectedMove.straddle}`} />
                <StatRow label="Exp Move" value={`±$${data.expectedMove.expectedMove} (${data.expectedMove.expectedMovePercent}%)`} />
                <StatRow label="IV" value={data.expectedMove.ivPercent ? `${data.expectedMove.ivPercent}%` : '—'}
                  tooltip={TOOLTIPS.iv} />
                <StatRow label="Range" value={`$${data.expectedMove.rangeLow} – $${data.expectedMove.rangeHigh}`} />
              </div>
            </div>
          )}

          {/* Earnings */}
          {data.earnings && (
            <div className="aiq-dd-section">
              <div className="aiq-dd-section__title">Earnings</div>
              <div className="aiq-dd-grid">
                <StatRow label="Next Date" value={fmtEarningsDate(data.earnings.earningsDate)} />
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
                {(() => {
                  const r = fmtRating(data.sentiment.recommendationKey);
                  return <StatRow label="Rating" value={r.label} valueColor={r.color} />;
                })()}
                <StatRow label="# Analysts" value={data.sentiment.numberOfAnalysts ?? '—'} />
                <StatRow label="Target" value={data.sentiment.targetMeanPrice ? fmtCurrency(data.sentiment.targetMeanPrice) : '—'} />
                <StatRow label="Upside" value={data.sentiment.targetVsPrice != null ? `${data.sentiment.targetVsPrice > 0 ? '+' : ''}${data.sentiment.targetVsPrice}%` : '—'}
                  valueColor={data.sentiment.targetVsPrice > 0 ? 'var(--accent-green)' : data.sentiment.targetVsPrice < 0 ? 'var(--accent-red)' : undefined}
                  tooltip={TOOLTIPS.upside} />
              </div>
            </div>
          )}

        </div>
      )}

      {/* Sticky Action Buttons */}
      {data && (
        <div className="aiq-dd-actions aiq-dd-actions--sticky">
          <button className="aiq-btn aiq-btn--primary" onClick={() => onBuildPlan?.({ ticker, strategy: activeStrategy, data })}>
            <Activity size={14} /> Build Trade Plan
          </button>
          <button className="aiq-btn" onClick={() => onChallengeBias?.()}>
            <MessageSquareWarning size={14} /> Challenge Bias
          </button>
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value, valueColor, tooltip }) {
  return (
    <div className="aiq-stat-row" title={tooltip || undefined}>
      <span className="aiq-stat-row__label">
        {label}
        {tooltip && <span className="aiq-stat-row__hint">?</span>}
      </span>
      <span className="aiq-stat-row__value" style={valueColor ? { color: valueColor } : undefined}>{value}</span>
    </div>
  );
}
