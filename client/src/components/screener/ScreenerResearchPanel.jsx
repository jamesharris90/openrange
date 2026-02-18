import { useState, useEffect } from 'react';
import TradingViewChart from '../shared/TradingViewChart';
import { ScoreGauge, Section, StatRow, LoadingSkeleton, safeFix, safePercent } from '../shared/ResearchPanelWidgets';
import { formatCurrency, formatPercent, formatMarketCap, formatVolume, formatFloat, getTimeAgo } from '../../utils/formatters';
import { calcScreenerScore, SCREENER_SCORE_MAX, SCREENER_SCORE_LABELS } from '../../utils/screenerScoring';
import {
  X, ExternalLink,
  TrendingUp, TrendingDown, Minus,
  BarChart3, Building2, MessageSquare, Newspaper, Activity,
} from 'lucide-react';

export default function ScreenerResearchPanel({ symbol, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAllNews, setShowAllNews] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setData(null);
    setShowAllNews(false);

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
  const em = d?.expectedMove ?? null;
  const c = d?.company ?? null;
  const s = d?.sentiment ?? null;
  const t = d?.technicals ?? null;
  const n = Array.isArray(d?.news) ? d.news : [];
  const scoreResult = d ? calcScreenerScore(d) : null;

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
          {c?.sector && <span className="erp__tag">{c.sector}</span>}
          {c?.industry && <span className="erp__tag">{c.industry}</span>}
        </div>
      )}

      {loading && <LoadingSkeleton />}
      {error && <div className="erp__error">Failed to load research data: {error}</div>}

      {d && (
        <>
          {/* Score Gauge with screener-specific scoring */}
          {scoreResult && (
            <ScoreGauge
              score={scoreResult.score}
              breakdown={scoreResult.breakdown}
              maxPerCategory={SCREENER_SCORE_MAX}
              labels={SCREENER_SCORE_LABELS}
            />
          )}

          {/* 1. Chart — default open for screener */}
          <Section title="Charts" icon={BarChart3} defaultOpen={true}>
            <div className="erp__charts">
              <div className="erp__chart-col">
                <div className="erp__chart-label">Intraday (5D)</div>
                <TradingViewChart symbol={symbol} height={280} interval="15" range="5D" hideSideToolbar />
              </div>
              <div className="erp__chart-col">
                <div className="erp__chart-label">Daily (3M)</div>
                <TradingViewChart symbol={symbol} height={280} interval="D" range="3M" hideSideToolbar />
              </div>
            </div>
          </Section>

          {/* 2. News & Catalysts */}
          <Section title="News & Catalysts" icon={Newspaper} defaultOpen={true}>
            {n.length > 0 ? (
              <div className="erp-news">
                {(showAllNews ? n : n.slice(0, 5)).map((item, i) => (
                  <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="erp-news-item">
                    <div className="erp-news-item__headline">{item.headline ?? 'Untitled'} <ExternalLink size={11} /></div>
                    <div className="erp-news-item__meta">
                      <span>{item.source ?? ''}</span>
                      {item.datetime > 0 && <span>{getTimeAgo(item.datetime * 1000)}</span>}
                    </div>
                  </a>
                ))}
                {!showAllNews && n.length > 5 && (
                  <button className="btn-secondary btn-sm" style={{ marginTop: 8, width: '100%' }}
                    onClick={() => setShowAllNews(true)}>
                    View More ({n.length - 5} more)
                  </button>
                )}
              </div>
            ) : (
              <div className="erp-empty">No recent news found</div>
            )}
          </Section>

          {/* 3. Expected Move */}
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

          {/* 4. Company Snapshot */}
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
                {c.recentInsiderTxns.slice(0, 5).map((tx, i) => (
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

          {/* 5. Analyst Sentiment */}
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
          </Section>

          {/* 6. Technical Summary */}
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
              </>
            ) : (
              <div className="erp-empty">Insufficient historical data</div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
