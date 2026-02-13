import { useState, useEffect, Component } from 'react';
import TradingViewChart from '../shared/TradingViewChart';
import { formatCurrency, formatPercent, formatMarketCap, formatVolume, formatFloat, getTimeAgo } from '../../utils/formatters';
import {
  X, ExternalLink, ChevronDown, ChevronRight,
  TrendingUp, TrendingDown, Minus,
  BarChart3, Target, Building2, MessageSquare, Newspaper, Activity,
} from 'lucide-react';

/* ── Error Boundary (catches render errors per-section) ── */
class SectionErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return <div className="erp-empty" style={{ color: 'var(--accent-orange)' }}>⚠ Failed to render this section</div>;
    }
    return this.props.children;
  }
}

/* ── Safe number formatting helpers ── */
const safeFix = (v, digits = 2) => { const n = Number(v); return isFinite(n) ? n.toFixed(digits) : null; };
const safePercent = (v) => { const n = Number(v); return isFinite(n) ? `${n > 0 ? '+' : ''}${n}%` : null; };

/* ── Score Gauge (circular SVG + breakdown bars) ── */
function ScoreGauge({ score = 0, breakdown }) {
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

  const maxPerCategory = {
    earningsTrack: 20, expectedMove: 15, liquidity: 15,
    shortInterest: 10, analystSentiment: 15, technicals: 15, newsMomentum: 10,
  };
  const labels = {
    earningsTrack: 'Earnings', expectedMove: 'Exp. Move', liquidity: 'Liquidity',
    shortInterest: 'Short Int.', analystSentiment: 'Analysts', technicals: 'Technicals', newsMomentum: 'News',
  };

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
            const maxVal = maxPerCategory[key] || 20;
            return (
              <div key={key} className="erp-score__item">
                <span className="erp-score__item-label">{labels[key] || key}</span>
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

/* ── Collapsible section ── */
function Section({ title, icon: Icon, children, defaultOpen = true }) {
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
function StatRow({ label, value, color }) {
  return (
    <div className="erp-stat-row">
      <span className="erp-stat-row__label">{label}</span>
      <span className="erp-stat-row__value" style={color ? { color } : undefined}>
        {value ?? '—'}
      </span>
    </div>
  );
}

/* ── Loading skeleton ── */
function LoadingSkeleton() {
  return (
    <div className="erp-loading">
      {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
        <div key={i} className="erp-skeleton" style={{ height: 18, width: `${50 + Math.random() * 50}%` }} />
      ))}
    </div>
  );
}

/* ── Main Panel ── */
export default function EarningsResearchPanel({ symbol, earningsRow, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setData(null);

    const controller = new AbortController();
    fetch(`/api/earnings-research/${symbol}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => {
        if (d && typeof d === 'object') { setData(d); } else { throw new Error('Invalid response'); }
        setLoading(false);
      })
      .catch(err => { if (err.name !== 'AbortError') { setError(err.message); setLoading(false); } });

    return () => controller.abort();
  }, [symbol]);

  if (!symbol) return null;

  const d = data;
  const e = d?.earnings ?? null;
  const em = d?.expectedMove ?? null;
  const c = d?.company ?? null;
  const s = d?.sentiment ?? null;
  const t = d?.technicals ?? null;
  const n = Array.isArray(d?.news) ? d.news : [];

  return (
    <div className="erp">
      {/* Header */}
      <div className="erp__header">
        <div className="erp__header-left">
          <h2>{symbol}</h2>
          {d?.name && <span className="erp__name">{d.name}</span>}
        </div>
        <button className="erp__close" onClick={onClose} type="button"><X size={20} /></button>
      </div>

      {/* Price bar */}
      {d && (
        <div className="erp__price-bar">
          <span className="erp__price">{d.price != null ? formatCurrency(d.price) : '—'}</span>
          {earningsRow?.changePercent != null && (
            <span style={{ color: earningsRow.changePercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
              {formatPercent(earningsRow.changePercent)}
            </span>
          )}
          {c?.sector && <span className="erp__tag">{c.sector}</span>}
          {c?.industry && <span className="erp__tag">{c.industry}</span>}
        </div>
      )}

      {loading && <LoadingSkeleton />}
      {error && <div className="erp__error">Failed to load research data: {error}</div>}

      {d && (
        <>
          {/* Earnings Setup Score */}
          <ScoreGauge score={d.setupScore?.score || 0} breakdown={d.setupScore?.breakdown} />

          {/* A. Earnings Intelligence (most important — first) */}
          <Section title="Earnings Intelligence" icon={Target} defaultOpen={true}>
            <StatRow label="Earnings Date" value={e?.earningsDate ?? null} />
            <StatRow label="EPS Estimate" value={safeFix(e?.epsEstimate) ? `$${safeFix(e.epsEstimate)}` : null} />
            <StatRow label="EPS Range"
              value={safeFix(e?.epsLow) && safeFix(e?.epsHigh) ? `$${safeFix(e.epsLow)} – $${safeFix(e.epsHigh)}` : null} />
            <StatRow label="Revenue Est." value={e?.revenueEstimate ? formatMarketCap(e.revenueEstimate) : null} />
            <StatRow label="Revenue Growth (YoY)"
              value={safePercent(e?.revenueGrowth)}
              color={e?.revenueGrowth > 0 ? 'var(--accent-green)' : e?.revenueGrowth < 0 ? 'var(--accent-red)' : undefined} />
            <StatRow label="Last 4Q Record"
              value={e ? `${e.beatsInLast4 ?? 0} beats · ${e.missesInLast4 ?? 0} misses` : null}
              color={e?.beatsInLast4 >= 3 ? 'var(--accent-green)' : e?.missesInLast4 >= 3 ? 'var(--accent-red)' : undefined} />

            {Array.isArray(e?.quarterlyHistory) && e.quarterlyHistory.length > 0 && (
              <div className="erp-quarters">
                {e.quarterlyHistory.map((q, i) => (
                  <div key={i} className="erp-quarter" style={{
                    borderLeft: `3px solid ${q.beat === true ? 'var(--accent-green)' : q.beat === false ? 'var(--accent-red)' : 'var(--border-color)'}`,
                  }}>
                    <span className="erp-quarter__label">{q.quarter ?? '—'}</span>
                    <span className="erp-quarter__vals">
                      {safeFix(q.actual) ? `$${safeFix(q.actual)}` : '—'}
                      {' / '}
                      {safeFix(q.estimate) ? `$${safeFix(q.estimate)}` : '—'}
                    </span>
                    {q.surprise != null && isFinite(Number(q.surprise)) && (
                      <span style={{ color: Number(q.surprise) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600, fontSize: 11 }}>
                        {Number(q.surprise) >= 0 ? '+' : ''}{q.surprise}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* B. Expected Move */}
          <Section title="Expected Move" icon={Activity} defaultOpen={true}>
            {em?.available ? (
              <>
                <StatRow label="ATM Straddle" value={safeFix(em.straddle) ? `$${safeFix(em.straddle)}` : null} />
                <StatRow label="Implied Volatility" value={em.ivPercent != null ? `${em.ivPercent}%` : null} />
                <StatRow label="Expected Move $" value={safeFix(em.expectedMove) ? `±$${safeFix(em.expectedMove)}` : null} />
                <StatRow label="Expected Move %"
                  value={em.expectedMovePercent != null ? `±${em.expectedMovePercent}%` : null}
                  color="var(--accent-orange)" />
                <StatRow label="Post-Earnings Range"
                  value={safeFix(em.rangeLow) && safeFix(em.rangeHigh) ? `$${safeFix(em.rangeLow)} – $${safeFix(em.rangeHigh)}` : null} />
                <StatRow label="Nearest Expiry" value={em.expiryDate ?? null} />
                <StatRow label="DTE" value={em.daysToExpiry != null ? `${em.daysToExpiry}d` : null} />
              </>
            ) : (
              <div className="erp-empty">No options data available</div>
            )}
          </Section>

          {/* C. Company Snapshot */}
          <Section title="Company Snapshot" icon={Building2} defaultOpen={true}>
            <StatRow label="Market Cap" value={c?.marketCap ? formatMarketCap(c.marketCap) : null} />
            <StatRow label="Float" value={c?.floatShares ? formatFloat(c.floatShares) : null} />
            <StatRow label="Avg Volume" value={c?.avgVolume ? formatVolume(c.avgVolume) : null} />
            <StatRow label="Short Interest"
              value={c?.shortPercentOfFloat != null ? `${c.shortPercentOfFloat}%` : null}
              color={c?.shortPercentOfFloat > 20 ? 'var(--accent-red)' : c?.shortPercentOfFloat > 10 ? 'var(--accent-orange)' : undefined} />
            <StatRow label="Short Ratio" value={safeFix(c?.shortRatio, 1)} />
            <StatRow label="Insider Ownership" value={c?.insiderPercent != null ? `${c.insiderPercent}%` : null} />
            <StatRow label="Institutional" value={c?.institutionalPercent != null ? `${c.institutionalPercent}%` : null} />
            <StatRow label="Beta" value={safeFix(c?.beta)} />

            {Array.isArray(c?.recentInsiderTxns) && c.recentInsiderTxns.length > 0 && (
              <div className="erp-insider-txns">
                <div className="erp-sub-label">Recent Insider Activity</div>
                {c.recentInsiderTxns.map((tx, i) => (
                  <div key={i} className="erp-insider-txn">
                    <span className="erp-insider-txn__name">{tx.name ?? '—'}</span>
                    <span className={`erp-insider-txn__type ${(tx.type || '').toLowerCase().includes('sale') ? 'sell' : 'buy'}`}>
                      {tx.type ?? '—'}
                    </span>
                    {tx.shares != null && <span>{formatFloat(Math.abs(tx.shares))}</span>}
                    {tx.date && <span className="erp-insider-txn__date">{tx.date}</span>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* D. Analyst Sentiment */}
          <Section title="Analyst Sentiment" icon={MessageSquare} defaultOpen={true}>
            <StatRow label="Consensus"
              value={s?.recommendationKey ? s.recommendationKey.replace(/_/g, ' ').toUpperCase() : null}
              color={
                s?.recommendationKey === 'buy' || s?.recommendationKey === 'strong_buy' ? 'var(--accent-green)'
                : s?.recommendationKey === 'sell' || s?.recommendationKey === 'strong_sell' ? 'var(--accent-red)'
                : undefined
              } />
            <StatRow label="Analysts" value={s?.numberOfAnalysts ?? null} />
            <StatRow label="Avg Target" value={s?.targetMeanPrice ? formatCurrency(s.targetMeanPrice) : null} />
            <StatRow label="Target vs Price"
              value={safePercent(s?.targetVsPrice)}
              color={s?.targetVsPrice > 0 ? 'var(--accent-green)' : s?.targetVsPrice < 0 ? 'var(--accent-red)' : undefined} />
            <StatRow label="Target Range"
              value={s?.targetLowPrice != null && s?.targetHighPrice != null
                ? `${formatCurrency(s.targetLowPrice)} – ${formatCurrency(s.targetHighPrice)}` : null} />

            {/* Stacked recommendation bar */}
            {s?.currentMonth && (() => {
              const cm = s.currentMonth;
              const total = (cm.strongBuy || 0) + (cm.buy || 0) + (cm.hold || 0) + (cm.sell || 0) + (cm.strongSell || 0);
              if (total === 0) return null;
              const segments = [
                { label: 'Strong Buy', abbr: 'SB', val: cm.strongBuy || 0, color: '#10b981' },
                { label: 'Buy', abbr: 'Buy', val: cm.buy || 0, color: '#34d399' },
                { label: 'Hold', abbr: 'Hold', val: cm.hold || 0, color: '#eab308' },
                { label: 'Sell', abbr: 'Sell', val: cm.sell || 0, color: '#f87171' },
                { label: 'Strong Sell', abbr: 'SS', val: cm.strongSell || 0, color: '#ef4444' },
              ].filter(r => r.val > 0);
              return (
                <div className="erp-rec-bar">
                  <div className="erp-sub-label">Analyst Ratings</div>
                  <div className="erp-rec-bar__track">
                    {segments.map(r => (
                      <div key={r.label} className="erp-rec-bar__seg" style={{ flex: r.val, background: r.color }}
                        title={`${r.label}: ${r.val}`} />
                    ))}
                  </div>
                  <div className="erp-rec-bar__labels">
                    {segments.map(r => (
                      <span key={r.label} style={{ color: r.color, fontWeight: 600, fontSize: 10 }}>
                        {r.val} {r.abbr}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Recent upgrades/downgrades */}
            {Array.isArray(s?.recentUpgrades) && s.recentUpgrades.length > 0 && (
              <div className="erp-upgrades">
                <div className="erp-sub-label">Recent Actions (90d)</div>
                {s.recentUpgrades.slice(0, 5).map((u, i) => (
                  <div key={i} className="erp-upgrade">
                    <span className={`erp-upgrade__action ${u.action || ''}`}>{u.action ?? '—'}</span>
                    <span className="erp-upgrade__firm">{u.firm ?? '—'}</span>
                    <span className="erp-upgrade__grade">{u.fromGrade ?? '?'} → {u.toGrade ?? '?'}</span>
                    {u.date && <span className="erp-upgrade__date">{u.date}</span>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* E. News & Catalysts */}
          <Section title="News & Catalysts" icon={Newspaper} defaultOpen={true}>
            {n.length > 0 ? (
              <div className="erp-news">
                {n.map((item, i) => (
                  <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="erp-news-item">
                    <div className="erp-news-item__headline">{item.headline ?? 'Untitled'} <ExternalLink size={11} /></div>
                    <div className="erp-news-item__meta">
                      <span>{item.source ?? ''}</span>
                      {item.datetime > 0 && <span>{getTimeAgo(item.datetime * 1000)}</span>}
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="erp-empty">No recent news found</div>
            )}
          </Section>

          {/* F. Technical Summary */}
          <Section title="Technical Summary" icon={TrendingUp} defaultOpen={true}>
            {t?.available ? (
              <>
                <div className="erp-trend-badge" data-trend={t.trend || 'mixed'}>
                  {t.trend === 'bullish' ? <TrendingUp size={14} />
                    : t.trend === 'bearish' ? <TrendingDown size={14} />
                    : <Minus size={14} />}
                  {(t.trend || 'mixed').charAt(0).toUpperCase() + (t.trend || 'mixed').slice(1)} Trend
                </div>

                <StatRow label="SMA 20" value={t.sma20 != null ? `$${t.sma20}` : null}
                  color={t.aboveSMA20 ? 'var(--accent-green)' : 'var(--accent-red)'} />
                <StatRow label="Dist SMA 20" value={safePercent(t.distSMA20)} />
                <StatRow label="SMA 50" value={t.sma50 != null ? `$${t.sma50}` : null}
                  color={t.aboveSMA50 ? 'var(--accent-green)' : 'var(--accent-red)'} />
                <StatRow label="SMA 200" value={t.sma200 != null ? `$${t.sma200}` : null}
                  color={t.aboveSMA200 ? 'var(--accent-green)' : 'var(--accent-red)'} />
                <StatRow label="RSI (14)" value={t.rsi ?? null}
                  color={t.rsi > 70 ? 'var(--accent-red)' : t.rsi < 30 ? 'var(--accent-green)' : undefined} />
                <StatRow label="ATR (14)" value={t.atr != null ? `$${t.atr}` : null} />
                <StatRow label="ATR %" value={t.atrPercent != null ? `${t.atrPercent}%` : null} />
                <StatRow label="52W High" value={t.high52w != null ? `$${t.high52w}` : null} />
                <StatRow label="Dist 52W High"
                  value={t.distHigh52w != null ? `${t.distHigh52w}%` : null}
                  color={t.distHigh52w != null && t.distHigh52w > -5 ? 'var(--accent-green)' : undefined} />
                <StatRow label="52W Low" value={t.low52w != null ? `$${t.low52w}` : null} />
                <StatRow label="Support (20d)" value={t.recentLow != null ? `$${t.recentLow}` : null} />
                <StatRow label="Resistance (20d)" value={t.recentHigh != null ? `$${t.recentHigh}` : null} />
              </>
            ) : (
              <div className="erp-empty">Insufficient historical data</div>
            )}
          </Section>

          {/* G. Charts — last, default closed (heavy TradingView widgets) */}
          <Section title="Charts" icon={BarChart3} defaultOpen={false}>
            <div className="erp__charts">
              <div className="erp__chart-col">
                <div className="erp__chart-label">Daily (3M)</div>
                <TradingViewChart symbol={symbol} height={300} interval="D" range="3M" hideSideToolbar />
              </div>
              <div className="erp__chart-col">
                <div className="erp__chart-label">15 Min (5D)</div>
                <TradingViewChart symbol={symbol} height={300} interval="15" range="5D" hideSideToolbar />
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
