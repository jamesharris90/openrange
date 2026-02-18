import React, { useEffect, useState, useRef, useCallback } from 'react';
import { RefreshCcw, AlertCircle, Plus, Download, Trash2, Target } from 'lucide-react';
import useWatchlist from '../hooks/useWatchlist';

// ── Utilities ────────────────────────────────────────
function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '--';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtInt(n) {
  if (n == null || isNaN(n)) return '--';
  return Number(n).toLocaleString('en-US');
}

function tierClass(tier) {
  return { high: 'em-tier-high', conditional: 'em-tier-conditional', low: 'em-tier-low', avoid: 'em-tier-avoid' }[tier] || 'em-tier-avoid';
}

function catBarColor(pct) {
  if (pct >= 70) return '#22c55e';
  if (pct >= 40) return '#f59e0b';
  return '#ef4444';
}

function hvRankColor(rank) {
  if (rank == null) return 'var(--text-muted)';
  if (rank < 25) return 'var(--accent-blue)';
  if (rank < 50) return 'var(--accent-green)';
  if (rank < 75) return 'var(--accent-orange)';
  return 'var(--accent-red)';
}

function hvRankLabel(rank) {
  if (rank == null) return '--';
  if (rank < 25) return 'Low';
  if (rank < 50) return 'Normal';
  if (rank < 75) return 'Elevated';
  return 'High';
}

function getStrategySuggestions(vol) {
  if (!vol) return [];
  const rank = vol.hvRank;
  if (rank == null) return [];
  if (rank >= 60) {
    return [
      { name: 'Iron Condor', level: 'HIGH', desc: 'Sell premium outside the expected move. High IV means richer premiums. Defined risk.' },
      { name: 'Credit Spread', level: 'HIGH', desc: "Sell a vertical spread in the direction you're biased against. Collects elevated premium." },
    ];
  }
  if (rank >= 40) {
    return [
      { name: 'Iron Condor', level: 'MEDIUM', desc: 'Sell premium outside the expected move. Moderate IV offers reasonable premium.' },
      { name: 'Butterfly', level: 'MEDIUM', desc: 'Low cost, defined risk. Profits if price stays near the center strike.' },
    ];
  }
  return [
    { name: 'Long Straddle', level: 'MEDIUM', desc: 'Buy ATM call + put. Low IV means cheaper options — profits from a volatility expansion.' },
    { name: 'Calendar Spread', level: 'MEDIUM', desc: 'Sell near-term, buy longer-term at same strike. Benefits from IV increase in back month.' },
  ];
}

const STORAGE_KEY = 'emWatchlist';
const REFRESH_MS = 5 * 60 * 1000;

export default function ExpectedMovePage() {
  const { items: globalWatchlistItems } = useWatchlist();
  const quickSymbols = globalWatchlistItems.length > 0
    ? globalWatchlistItems.map(i => i.symbol)
    : ['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'AMZN', 'META'];
  const [ticker, setTicker] = useState(() => localStorage.getItem('emLastTicker') || 'AAPL');
  const [input, setInput] = useState(() => localStorage.getItem('emLastTicker') || 'AAPL');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Watchlist
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  });
  const [wlData, setWlData] = useState({});
  const [addInput, setAddInput] = useState('');

  // Auto-refresh
  const [countdown, setCountdown] = useState(REFRESH_MS / 1000);
  const refreshRef = useRef(null);
  const countdownRef = useRef(null);

  const fetchData = useCallback(async (sym) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/expected-move-enhanced?ticker=${encodeURIComponent(sym)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setData(json);
      setTicker(sym);
      setInput(sym);
      localStorage.setItem('emLastTicker', sym);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + auto-refresh
  useEffect(() => {
    fetchData(ticker);
    const startRefresh = () => {
      clearInterval(refreshRef.current);
      clearInterval(countdownRef.current);
      setCountdown(REFRESH_MS / 1000);
      refreshRef.current = setInterval(() => {
        fetchData(ticker);
        setCountdown(REFRESH_MS / 1000);
      }, REFRESH_MS);
      countdownRef.current = setInterval(() => {
        setCountdown(prev => Math.max(0, prev - 1));
      }, 1000);
    };
    startRefresh();
    return () => { clearInterval(refreshRef.current); clearInterval(countdownRef.current); };
  }, [ticker, fetchData]);

  // Fetch watchlist data
  const fetchWlTicker = useCallback(async (sym) => {
    try {
      const resp = await fetch(`/api/expected-move-enhanced?ticker=${encodeURIComponent(sym)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setWlData(prev => ({ ...prev, [sym]: json }));
    } catch (e) {
      setWlData(prev => ({ ...prev, [sym]: { _error: e.message } }));
    }
  }, []);

  useEffect(() => {
    watchlist.forEach(sym => { if (!wlData[sym]) fetchWlTicker(sym); });
  }, [watchlist, wlData, fetchWlTicker]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) fetchData(input.trim().toUpperCase());
  };

  const addToWatchlist = () => {
    const sym = addInput.trim().toUpperCase();
    if (!sym || watchlist.includes(sym)) { setAddInput(''); return; }
    setWatchlist(prev => [...prev, sym]);
    setAddInput('');
    fetchWlTicker(sym);
  };

  const removeFromWatchlist = (sym) => {
    setWatchlist(prev => prev.filter(t => t !== sym));
    setWlData(prev => { const next = { ...prev }; delete next[sym]; return next; });
  };

  const refreshWatchlist = async () => {
    for (const sym of watchlist) await fetchWlTicker(sym);
  };

  const exportCSV = () => {
    const headers = ['Ticker','Price','Exp Move $','Exp Move %','ATM IV','HV Rank','Expiry','Earnings','Score'];
    const rows = watchlist.map(sym => {
      const d = wlData[sym];
      if (!d || d._error) return [sym,'','','','','','','',''].join(',');
      return [
        sym, d.price ?? '', d.expectedMove ?? '', d.expectedMovePercent ?? '',
        d.volatility?.avgIV ?? '', d.volatility?.hvRank ?? '',
        d.options?.expirationDate ?? '', d.earnings?.nextDate ?? '',
        d.scoring?.composite ?? '',
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `expected-move-${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const prob = data?.probability || {};
  const options = data?.options || {};
  const scoring = data?.scoring || {};
  const vol = data?.volatility || {};
  const tier = scoring?.tier || { label: '--', tier: 'avoid', color: '#6b7280' };
  const categories = scoring?.categories || {};
  const strategies = getStrategySuggestions(vol);
  const countdownMin = Math.floor(countdown / 60);
  const countdownSec = String(Math.floor(countdown % 60)).padStart(2, '0');

  // Composite ring
  const circumference = 2 * Math.PI * 52;
  const composite = scoring?.composite ?? 0;
  const dashOffset = circumference - (composite / 100) * circumference;

  return (
    <div className="em-page">
      {/* Header bar */}
      <div className="em-header-bar">
        <form onSubmit={handleSubmit} className="em-search">
          <input name="ticker" className="em-input" value={input} onChange={e => setInput(e.target.value.toUpperCase())} placeholder="Enter ticker…" />
          <button className="em-btn-primary" type="submit">Analyze</button>
          <div className="em-quick-symbols">
            {quickSymbols.map(sym => (
              <button key={sym} type="button" className="em-quick-btn" onClick={() => fetchData(sym)}>{sym}</button>
            ))}
          </div>
        </form>
      </div>

      {error && (
        <div className="em-card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-orange)' }}>
            <AlertCircle size={16} /> <span>{error}</span>
          </div>
        </div>
      )}

      {loading && !data && <div className="em-card">Loading expected move…</div>}

      {data && (
        <>
          {/* Hero: Price + Composite Score */}
          <div className="em-hero-grid">
            {/* Price & Expected Move Card */}
            <div className="em-card">
              <div className="em-price-header">
                <span className="em-ticker-name">{data.ticker}</span>
                {data.sector && <span className="em-sector-tag">{data.sector}{data.sectorETF ? ` · ${data.sectorETF}` : ''}</span>}
              </div>
              <div className="em-price-large">${fmt(data.price)}</div>
              <div className={`em-change ${(data.change || 0) >= 0 ? 'positive' : 'negative'}`}>
                {(data.change || 0) >= 0 ? '+' : ''}{fmt(data.change)} ({(data.changePercent || 0) >= 0 ? '+' : ''}{fmt(data.changePercent)}%)
              </div>

              {data.earnings?.nextInDays != null && data.earnings.nextInDays > 0 && data.earnings.nextInDays <= 21 && (
                <div style={{ marginTop: 8 }}>
                  <span className={`em-earnings-badge ${data.earnings.nextInDays <= 7 ? 'danger' : 'warning'}`}>
                    &#9889; Earnings in {data.earnings.nextInDays}d{data.earnings.nextDate ? ` (${data.earnings.nextDate})` : ''}
                  </span>
                </div>
              )}

              <div className="em-move-section">
                <div className="em-move-label">Expected Move ({options.expirationDate || 'nearest expiry'})</div>
                <div>
                  <span className="em-move-value">&plusmn;${fmt(data.expectedMove)}</span>
                  <span className="em-move-pct">&plusmn;{fmt(data.expectedMovePercent)}%</span>
                  <span className="em-method-tag">{prob.method || 'ATM Straddle'}</span>
                </div>
                <div className="em-range-text">
                  Range: <strong>${fmt(data.rangeLow)}</strong> — <strong>${fmt(data.rangeHigh)}</strong>
                </div>

                {/* Range bar */}
                <RangeBar price={data.price} low={data.rangeLow} high={data.rangeHigh} />

                <div className="em-probability-row">
                  <div className="em-prob-badge"><span className="label">1SD Containment</span><span className="value clr-green">{fmt(prob.containment, 1)}%</span></div>
                  <div className="em-prob-badge"><span className="label">Breach Probability</span><span className="value clr-red">{fmt(prob.breach, 1)}%</span></div>
                </div>
                <div className="em-expiry-badge">
                  {options.daysToExpiry || 0} day{(options.daysToExpiry || 0) !== 1 ? 's' : ''} to expiry
                  {' · '}{options.callsCount || 0} calls · {options.putsCount || 0} puts
                  {data.beta != null && <> · &beta;={fmt(data.beta)}</>}
                </div>
              </div>
            </div>

            {/* Composite Score Card */}
            <div className="em-card em-score-card">
              <div className="em-score-header"><span className="em-score-title">Composite Confidence Score</span></div>
              <div className="em-composite-ring">
                <svg width="120" height="120" viewBox="0 0 120 120">
                  <circle className="ring-bg" cx="60" cy="60" r="52" />
                  <circle className="ring-fill" cx="60" cy="60" r="52" stroke={tier.color} strokeDasharray={circumference} strokeDashoffset={dashOffset} />
                </svg>
                <span className="em-composite-number">{composite}</span>
              </div>
              <div className={`em-tier-label ${tierClass(tier.tier)}`}>{tier.label}</div>
              <div className="em-category-bars">
                {Object.entries(categories).map(([key, cat]) => (
                  <div key={key} className="em-cat-row">
                    <span className="em-cat-label">{cat.label}</span>
                    <div className="em-cat-bar-wrap">
                      <div className="em-cat-bar-fill" style={{ width: `${cat.pct}%`, background: catBarColor(cat.pct) }} />
                    </div>
                    <span className="em-cat-score">{cat.score}/{cat.max}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ATM Options */}
          <div className="em-card" style={{ marginBottom: 16 }}>
            <h3 className="em-section-title">ATM Options — Strike ${fmt(options.atmStrike)}</h3>
            <div className="em-atm-grid">
              <ATMSide title="ATM Call" data={options.atmCall} />
              <ATMSide title="ATM Put" data={options.atmPut} />
            </div>
            <div className="em-atm-summary">
              <div className="em-atm-row"><span className="label">Straddle Mid</span><span className="value">${fmt(data.straddleMid)}</span></div>
              <div className="em-atm-row"><span className="label">IV-Derived EM</span><span className="value">${fmt(data.ivExpectedMove)}</span></div>
            </div>
          </div>

          {/* Volatility + Strategy */}
          <div className="em-two-col">
            {/* Volatility Rank */}
            <div className="em-card">
              <h3 className="em-section-title">Volatility Rank</h3>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                HV Rank: <span style={{ color: hvRankColor(vol.hvRank) }}>{vol.hvRank != null ? fmt(vol.hvRank, 1) : '--'} — {hvRankLabel(vol.hvRank)}</span>
              </div>
              <div className="em-hv-gauge">
                <div className="em-hv-gauge-fill" style={{ width: `${Math.max(vol.hvRank || 0, 3)}%`, background: hvRankColor(vol.hvRank) }}>
                  {vol.hvRank != null && <span className="em-hv-gauge-label">{Math.round(vol.hvRank)}</span>}
                </div>
              </div>
              <div className="em-hv-labels"><span>0 — Low</span><span>50 — Normal</span><span>100 — High</span></div>
              <div className="em-stat-list">
                <div className="em-stat-row"><span className="label">Current 20-day HV (annualized)</span><span className="value">{vol.hvCurrent20 != null ? `${vol.hvCurrent20}%` : '--'}</span></div>
                <div className="em-stat-row"><span className="label">52-Week HV High</span><span className="value">{vol.hvHigh52w != null ? `${vol.hvHigh52w}%` : '--'}</span></div>
                <div className="em-stat-row"><span className="label">52-Week HV Low</span><span className="value">{vol.hvLow52w != null ? `${vol.hvLow52w}%` : '--'}</span></div>
                <div className="em-stat-row"><span className="label">ATM Implied Volatility</span><span className="value">{vol.avgIV != null ? `${vol.avgIV}%` : '--'}</span></div>
                <div className="em-stat-row">
                  <span className="label">IV vs HV Spread</span>
                  <span className="value" style={{ color: vol.ivHvSpread != null ? (vol.ivHvSpread > 0 ? 'var(--accent-orange)' : 'var(--accent-green)') : undefined }}>
                    {vol.ivHvSpread != null ? `${vol.ivHvSpread > 0 ? '+' : ''}${vol.ivHvSpread}% (IV ${vol.ivHvSpread > 0 ? 'premium' : 'discount'})` : '--'}
                  </span>
                </div>
              </div>
            </div>

            {/* Strategy Suggestions */}
            <div className="em-card">
              <h3 className="em-section-title">Strategy Suggestions</h3>
              {strategies.length === 0 ? (
                <div className="em-muted">Analyze a ticker to see suggestions.</div>
              ) : (
                <div className="em-strategy-list">
                  {strategies.map((s, i) => (
                    <div key={i} className="em-strategy-item">
                      <div className="em-strategy-header">
                        <strong>{s.name}</strong>
                        <span className={`em-level-badge ${s.level.toLowerCase()}`}>{s.level}</span>
                      </div>
                      <div className="em-strategy-desc">{s.desc}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Watchlist */}
          <div className="em-card em-watchlist-section">
            <div className="em-watchlist-header">
              <h3 className="em-section-title" style={{ margin: 0 }}>Expected Move Watchlist</h3>
              <div className="em-watchlist-actions">
                <input name="addTicker" className="em-input em-input-sm" value={addInput}
                  onChange={e => setAddInput(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addToWatchlist())}
                  placeholder="Ticker" />
                <button className="em-btn-primary em-btn-sm" type="button" onClick={addToWatchlist}><Plus size={14} /> Add</button>
                <button className="em-btn-secondary em-btn-sm" type="button" onClick={exportCSV}><Download size={14} /> Export CSV</button>
                <button className="em-btn-secondary em-btn-sm" type="button" onClick={refreshWatchlist}><RefreshCcw size={14} /> Refresh</button>
              </div>
            </div>
            {watchlist.length === 0 ? (
              <div className="em-empty">No tickers in watchlist. Add tickers above to track expected moves.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="em-wl-table">
                  <thead>
                    <tr>
                      <th>Ticker</th><th>Price</th><th>Exp Move $</th><th>Exp Move %</th>
                      <th>ATM IV</th><th>HV Rank</th><th>Expiry</th><th>Earnings</th><th>Score</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchlist.map(sym => {
                      const d = wlData[sym];
                      if (!d) return (
                        <tr key={sym}><td><strong style={{ color: 'var(--accent-blue)' }}>{sym}</strong></td><td colSpan={8}>Loading…</td><td><button className="em-remove-btn" onClick={() => removeFromWatchlist(sym)}>Remove</button></td></tr>
                      );
                      if (d._error) return (
                        <tr key={sym}><td><strong>{sym}</strong></td><td colSpan={8} style={{ color: 'var(--text-muted)' }}>{d._error}</td><td><button className="em-remove-btn" onClick={() => removeFromWatchlist(sym)}>Remove</button></td></tr>
                      );
                      const wVol = d.volatility || {};
                      const wEarn = d.earnings || {};
                      const wOpts = d.options || {};
                      const wScore = d.scoring || {};
                      const wTier = wScore.tier || {};
                      const hasEarnings = wEarn.nextInDays != null && wEarn.nextInDays > 0 && wEarn.nextInDays <= 60;
                      return (
                        <tr key={sym} className={hasEarnings && wEarn.nextInDays <= 7 ? 'em-row-highlight' : ''} onClick={() => fetchData(sym)} style={{ cursor: 'pointer' }}>
                          <td><strong style={{ color: 'var(--accent-blue)' }}>{sym}</strong></td>
                          <td>${fmt(d.price)}</td>
                          <td>&plusmn;${fmt(d.expectedMove)}</td>
                          <td>&plusmn;{fmt(d.expectedMovePercent)}%</td>
                          <td>{wVol.avgIV != null ? <span className={`em-iv-cell ${ivCellClass(wVol.hvRank)}`}>{fmt(wVol.avgIV, 1)}%</span> : '--'}</td>
                          <td>{wVol.hvRank != null ? <span className={`em-iv-cell ${ivCellClass(wVol.hvRank)}`}>{Math.round(wVol.hvRank)}</span> : '--'}</td>
                          <td style={{ fontSize: '0.85em' }}>{wOpts.expirationDate || '--'}</td>
                          <td>
                            {hasEarnings && (
                              <span className={`em-earnings-badge ${wEarn.nextInDays <= 7 ? 'danger' : 'warning'}`}>&#9889; {wEarn.nextInDays}d</span>
                            )}
                          </td>
                          <td>
                            {wScore.composite != null && (
                              <span className={`em-score-pill ${tierClass(wTier.tier)}`}>{wScore.composite} {wTier.label}</span>
                            )}
                          </td>
                          <td><button className="em-remove-btn" onClick={(e) => { e.stopPropagation(); removeFromWatchlist(sym); }}>Remove</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <style>{emStyles}</style>
    </div>
  );
}

function RangeBar({ price, low, high }) {
  if (!price || !low || !high || high <= low) return null;
  const margin = (high - low) * 0.25;
  const barLow = low - margin, barHigh = high + margin;
  const range = barHigh - barLow;
  if (range <= 0) return null;
  const pL = ((low - barLow) / range) * 100;
  const pP = ((price - barLow) / range) * 100;
  const pH = ((high - barLow) / range) * 100;
  return (
    <div className="em-range-bar-wrap">
      <div className="em-range-bar">
        <div className="em-range-marker" style={{ left: `${pL}%`, background: 'var(--accent-red)' }} />
        <div className="em-range-dot" style={{ left: `${pP}%` }} />
        <div className="em-range-marker" style={{ left: `${pH}%`, background: 'var(--accent-green)' }} />
        <div className="em-range-label low" style={{ left: `${pL}%` }}>${fmt(low)}</div>
        <div className="em-range-label mid" style={{ left: `${pP}%` }}>${fmt(price)}</div>
        <div className="em-range-label high" style={{ left: `${pH}%` }}>${fmt(high)}</div>
      </div>
    </div>
  );
}

function ATMSide({ title, data }) {
  if (!data) return (
    <div className="em-atm-card"><h4>{title}</h4><div className="em-muted">Not available</div></div>
  );
  return (
    <div className="em-atm-card">
      <h4>{title} — Strike ${fmt(data.strike)}</h4>
      <div className="em-atm-row"><span className="label">Bid / Ask</span><span className="value">${fmt(data.bid)} / ${fmt(data.ask)}</span></div>
      <div className="em-atm-row"><span className="label">Mid</span><span className="value">${fmt(data.mid)}</span></div>
      <div className="em-atm-row"><span className="label">IV</span><span className="value">{data.iv != null ? `${(data.iv * 100).toFixed(1)}%` : '--'}</span></div>
      <div className="em-atm-row"><span className="label">Volume</span><span className="value">{fmtInt(data.volume)}</span></div>
      <div className="em-atm-row"><span className="label">Open Interest</span><span className="value">{fmtInt(data.openInterest)}</span></div>
    </div>
  );
}

function ivCellClass(hvRank) {
  if (hvRank == null) return '';
  if (hvRank < 25) return 'em-iv-low';
  if (hvRank < 50) return 'em-iv-normal';
  if (hvRank < 75) return 'em-iv-elevated';
  return 'em-iv-high';
}

const emStyles = `
/* ── Expected Move Page ─────────────────────── */
.em-page { max-width: 1400px; }

.em-header-bar {
  margin-bottom: 16px;
}
.em-search {
  display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
}
.em-input {
  background: var(--bg-card); border: 1px solid var(--border-color);
  color: var(--text-primary); padding: 10px 16px; border-radius: 8px;
  font-size: 1rem; width: 180px; text-transform: uppercase;
}
.em-input:focus {
  outline: none; border-color: var(--accent-blue);
  box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
}
.em-input-sm { width: 100px; padding: 7px 12px; font-size: 0.85rem; }
.em-btn-primary {
  background: var(--accent-blue); color: #fff; border: none;
  padding: 10px 20px; border-radius: 8px; font-weight: 600;
  cursor: pointer; font-size: 0.95rem; transition: background 0.15s;
  display: inline-flex; align-items: center; gap: 6px;
}
.em-btn-primary:hover { background: #2563eb; }
.em-btn-sm { padding: 7px 14px; font-size: 0.82rem; }
.em-btn-secondary {
  background: var(--bg-surface); border: 1px solid var(--border-color);
  color: var(--text-secondary); padding: 10px 16px; border-radius: 8px;
  font-weight: 600; cursor: pointer; font-size: 0.82rem;
  display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s;
}
.em-btn-secondary:hover { border-color: var(--accent-blue); color: var(--accent-blue); }

.em-quick-symbols { display: flex; gap: 6px; flex-wrap: wrap; }
.em-quick-btn {
  background: var(--bg-card); border: 1px solid var(--border-color);
  color: var(--text-secondary); padding: 6px 12px; border-radius: 6px;
  cursor: pointer; font-size: 0.82rem; font-weight: 600; transition: all 0.15s;
}
.em-quick-btn:hover {
  border-color: var(--accent-blue); color: var(--accent-blue);
  background: rgba(59,130,246,0.08);
}

/* Cards */
.em-card {
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: 12px; padding: 24px; margin-bottom: 16px;
}

/* Hero Grid */
.em-hero-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 0;
}
.em-hero-grid .em-card { margin-bottom: 16px; }
@media (max-width: 900px) { .em-hero-grid { grid-template-columns: 1fr; } }

/* Price Card */
.em-price-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
.em-ticker-name { font-size: 1.6rem; font-weight: 800; color: var(--text-primary); }
.em-sector-tag {
  font-size: 0.78rem; color: var(--text-muted); background: var(--bg-surface);
  padding: 3px 10px; border-radius: 20px;
}
.em-price-large { font-size: 2.2rem; font-weight: 700; color: var(--text-primary); line-height: 1.1; margin: 4px 0; }
.em-change { font-size: 0.95rem; font-weight: 600; }
.em-change.positive { color: var(--accent-green); }
.em-change.negative { color: var(--accent-red); }

.em-earnings-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 12px; border-radius: 6px; font-size: 0.82rem; font-weight: 600;
}
.em-earnings-badge.danger { background: rgba(239,68,68,0.15); color: var(--accent-red); }
.em-earnings-badge.warning { background: rgba(245,158,11,0.15); color: var(--accent-orange); }

.em-move-section { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-color); }
.em-move-label {
  font-size: 0.82rem; color: var(--text-muted); text-transform: uppercase;
  letter-spacing: 0.5px; margin-bottom: 6px; font-weight: 600;
}
.em-move-value { font-size: 1.8rem; font-weight: 700; color: var(--accent-blue); }
.em-move-pct { font-size: 1.1rem; color: var(--text-secondary); margin-left: 8px; }
.em-range-text { color: var(--text-secondary); margin-top: 6px; font-size: 0.92rem; }
.em-method-tag {
  font-size: 0.75rem; color: var(--text-muted); background: var(--bg-surface);
  padding: 2px 8px; border-radius: 4px; margin-left: 4px;
}
.em-probability-row { display: flex; gap: 16px; margin-top: 12px; flex-wrap: wrap; }
.em-prob-badge {
  display: flex; align-items: center; gap: 6px;
  background: var(--bg-surface); padding: 6px 12px; border-radius: 8px; font-size: 0.85rem;
}
.em-prob-badge .label { color: var(--text-muted); }
.em-prob-badge .value { font-weight: 700; }
.clr-green { color: var(--accent-green); }
.clr-red { color: var(--accent-red); }
.em-expiry-badge { font-size: 0.82rem; color: var(--text-muted); margin-top: 8px; }

/* Range Bar */
.em-range-bar-wrap { margin: 20px 0 8px; position: relative; height: 50px; }
.em-range-bar {
  position: absolute; top: 18px; left: 0; right: 0;
  height: 6px; background: var(--bg-surface); border-radius: 3px;
}
.em-range-marker {
  position: absolute; top: -6px; width: 3px; height: 18px;
  border-radius: 2px; transform: translateX(-50%);
}
.em-range-dot {
  position: absolute; top: -5px; width: 16px; height: 16px;
  background: var(--accent-blue); border-radius: 50%;
  transform: translateX(-50%); border: 2px solid var(--bg-card);
  box-shadow: 0 0 6px rgba(59,130,246,0.4);
}
.em-range-label {
  position: absolute; top: 22px; transform: translateX(-50%);
  font-size: 0.78rem; color: var(--text-muted); white-space: nowrap;
}
.em-range-label.mid { color: var(--accent-blue); font-weight: 600; }

/* Composite Score Card */
.em-score-card { display: flex; flex-direction: column; }
.em-score-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.em-score-title {
  font-size: 0.82rem; color: var(--text-muted); text-transform: uppercase;
  letter-spacing: 0.5px; font-weight: 600;
}
.em-composite-ring { position: relative; width: 120px; height: 120px; margin: 0 auto 12px; }
.em-composite-ring svg { transform: rotate(-90deg); }
.em-composite-ring .ring-bg { fill: none; stroke: var(--border-color); stroke-width: 8; }
.em-composite-ring .ring-fill {
  fill: none; stroke-width: 8; stroke-linecap: round;
  transition: stroke-dashoffset 0.8s ease, stroke 0.3s;
}
.em-composite-number {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 2rem; font-weight: 800; color: var(--text-primary);
}
.em-tier-label {
  text-align: center; font-size: 0.95rem; font-weight: 700;
  padding: 6px 16px; border-radius: 8px; margin-bottom: 16px;
}
.em-tier-high { background: rgba(34,197,94,0.15); color: #22c55e; }
.em-tier-conditional { background: rgba(245,158,11,0.15); color: #f59e0b; }
.em-tier-low { background: rgba(239,68,68,0.15); color: #ef4444; }
.em-tier-avoid { background: rgba(107,114,128,0.15); color: #6b7280; }

/* Category Bars */
.em-category-bars { flex: 1; }
.em-cat-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 0.82rem; }
.em-cat-label {
  width: 130px; color: var(--text-secondary); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;
}
.em-cat-bar-wrap {
  flex: 1; height: 8px; background: var(--bg-surface);
  border-radius: 4px; overflow: hidden;
}
.em-cat-bar-fill { height: 100%; border-radius: 4px; transition: width 0.6s ease; }
.em-cat-score { width: 44px; text-align: right; font-weight: 600; color: var(--text-primary); flex-shrink: 0; }

/* Section Title */
.em-section-title {
  font-size: 0.88rem; color: var(--text-muted); text-transform: uppercase;
  letter-spacing: 0.5px; margin: 0 0 14px 0; font-weight: 600;
}

/* ATM Grid */
.em-atm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 600px) { .em-atm-grid { grid-template-columns: 1fr; } }
.em-atm-card { background: var(--bg-surface); border-radius: 8px; padding: 14px; }
.em-atm-card h4 { font-size: 0.82rem; color: var(--text-primary); margin: 0 0 10px 0; font-weight: 700; }
.em-atm-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 0.82rem; }
.em-atm-row .label { color: var(--text-muted); }
.em-atm-row .value { color: var(--text-primary); font-weight: 600; }
.em-atm-summary { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border-color); }

/* Two Column Layout */
.em-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 0; }
.em-two-col .em-card { margin-bottom: 16px; }
@media (max-width: 900px) { .em-two-col { grid-template-columns: 1fr; } }

/* Volatility Gauge */
.em-hv-gauge {
  height: 16px; background: var(--bg-surface); border-radius: 8px;
  overflow: hidden; margin: 8px 0; position: relative;
}
.em-hv-gauge-fill {
  height: 100%; border-radius: 8px; transition: width 0.6s;
  display: flex; align-items: center; justify-content: flex-end; padding-right: 6px;
}
.em-hv-gauge-label { font-size: 0.7rem; font-weight: 700; color: #fff; }
.em-hv-labels {
  display: flex; justify-content: space-between;
  font-size: 0.72rem; color: var(--text-muted); margin-bottom: 14px;
}

.em-stat-list { margin-top: 4px; }
.em-stat-row {
  display: flex; justify-content: space-between; padding: 6px 0;
  font-size: 0.85rem; border-bottom: 1px solid var(--border-color);
}
.em-stat-row:last-child { border-bottom: none; }
.em-stat-row .label { color: var(--text-muted); }
.em-stat-row .value { font-weight: 600; color: var(--text-primary); }

/* Strategy */
.em-strategy-list { display: flex; flex-direction: column; gap: 12px; }
.em-strategy-item {
  background: var(--bg-surface); border-radius: 8px; padding: 14px;
}
.em-strategy-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.em-strategy-header strong { color: var(--text-primary); }
.em-level-badge {
  font-size: 0.72rem; font-weight: 700; padding: 2px 8px;
  border-radius: 4px; text-transform: uppercase;
}
.em-level-badge.high { background: rgba(34,197,94,0.15); color: #22c55e; }
.em-level-badge.medium { background: rgba(59,130,246,0.15); color: var(--accent-blue); }
.em-level-badge.low { background: rgba(245,158,11,0.15); color: var(--accent-orange); }
.em-strategy-desc { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4; }

/* Watchlist */
.em-watchlist-section { overflow: hidden; }
.em-watchlist-header {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px; margin-bottom: 16px;
}
.em-watchlist-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.em-wl-table { width: 100%; border-collapse: collapse; }
.em-wl-table th {
  text-align: left; padding: 10px 12px; font-size: 0.78rem;
  text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted);
  background: var(--bg-surface); border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}
.em-wl-table td {
  padding: 10px 12px; font-size: 0.85rem;
  border-bottom: 1px solid var(--border-color); color: var(--text-primary);
}
.em-wl-table tbody tr { transition: background 0.12s; }
.em-wl-table tbody tr:hover { background: rgba(59,130,246,0.05); }
.em-row-highlight { background: rgba(245,158,11,0.06); }
.em-remove-btn {
  background: transparent; border: 1px solid var(--border-color);
  color: var(--text-muted); padding: 4px 10px; border-radius: 4px;
  cursor: pointer; font-size: 0.78rem;
}
.em-remove-btn:hover { border-color: var(--accent-red); color: var(--accent-red); }
.em-empty { padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.9rem; }
.em-muted { color: var(--text-muted); font-size: 0.9rem; }

/* IV cells */
.em-iv-cell {
  display: inline-flex; padding: 2px 8px; border-radius: 4px;
  font-weight: 600; font-size: 0.82rem;
}
.em-iv-low { background: rgba(59,130,246,0.12); color: var(--accent-blue); }
.em-iv-normal { background: rgba(34,197,94,0.12); color: var(--accent-green); }
.em-iv-elevated { background: rgba(245,158,11,0.12); color: var(--accent-orange); }
.em-iv-high { background: rgba(239,68,68,0.12); color: var(--accent-red); }

/* Score pill */
.em-score-pill {
  display: inline-flex; padding: 3px 10px; border-radius: 20px;
  font-size: 0.82rem; font-weight: 700; white-space: nowrap;
}
`;
