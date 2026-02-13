import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import useMarketContext from '../../hooks/useMarketContext';

const BIAS_CONFIG = {
  bullish: { icon: TrendingUp, color: 'var(--accent-green)', label: 'BULLISH', bg: 'rgba(34,197,94,0.10)' },
  bearish: { icon: TrendingDown, color: 'var(--accent-red)', label: 'BEARISH', bg: 'rgba(239,68,68,0.10)' },
  neutral: { icon: Minus, color: 'var(--accent-orange)', label: 'NEUTRAL', bg: 'rgba(234,179,8,0.10)' },
};

function SectorPerformance() {
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchSectors = useCallback(async () => {
    try {
      const r = await fetch('/api/ai-quant/sector-performance');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setSectors(json.sectors || []);
    } catch { setSectors([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSectors(); }, [fetchSectors]);

  if (loading) return <div className="aiq-section-label" style={{ opacity: 0.5 }}>Loading sectors…</div>;
  if (!sectors.length) return null;

  const visible = expanded ? sectors : sectors.slice(0, 6);

  return (
    <div className="aiq-sectors">
      <div className="aiq-section-label">Sector Performance</div>
      {visible.map(s => (
        <div key={s.etf} className="aiq-sector-row">
          <span className="aiq-sector-row__name">{s.sector}</span>
          <span className="aiq-sector-row__etf">{s.etf}</span>
          <span className={`aiq-sector-row__change ${s.changePercent >= 0 ? 'positive' : 'negative'}`}>
            {s.changePercent >= 0 ? '+' : ''}{s.changePercent.toFixed(2)}%
          </span>
          <div className="aiq-sector-bar-wrap">
            <div className={`aiq-sector-bar ${s.changePercent >= 0 ? 'aiq-sector-bar--up' : 'aiq-sector-bar--down'}`}
              style={{ width: `${Math.min(100, Math.abs(s.changePercent) * 20)}%` }} />
          </div>
        </div>
      ))}
      {sectors.length > 6 && (
        <button className="aiq-sectors-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? <><ChevronUp size={12} /> Less</> : <><ChevronDown size={12} /> All {sectors.length} sectors</>}
        </button>
      )}
    </div>
  );
}

export default function MarketContextPanel() {
  const { data, loading, error, refresh } = useMarketContext();

  if (loading) return <div className="aiq-panel aiq-market"><div className="aiq-panel__loading">Loading market context…</div></div>;
  if (error) return <div className="aiq-panel aiq-market"><div className="aiq-panel__error">Error: {error}</div></div>;
  if (!data) return null;

  const { indices, bias, biasReasons, technicals } = data;
  const cfg = BIAS_CONFIG[bias] || BIAS_CONFIG.neutral;
  const BiasIcon = cfg.icon;

  return (
    <div className="aiq-panel aiq-market">
      <div className="aiq-panel__header">
        <h3>Market Context</h3>
        <button className="aiq-icon-btn" onClick={refresh} title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Bias Badge */}
      <div className="aiq-bias-badge" style={{ background: cfg.bg, borderColor: cfg.color }}>
        <BiasIcon size={18} color={cfg.color} />
        <span style={{ color: cfg.color, fontWeight: 700 }}>{cfg.label}</span>
      </div>

      {/* Bias Reasons */}
      {biasReasons?.length > 0 && (
        <ul className="aiq-bias-reasons">
          {biasReasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}

      {/* Index Prices */}
      <div className="aiq-indices">
        {(indices || []).map(idx => {
          if (idx.error) return <div key={idx.ticker} className="aiq-index-row aiq-index-row--error">{idx.ticker}: unavailable</div>;
          const isUp = idx.changePercent >= 0;
          return (
            <div key={idx.ticker} className="aiq-index-row">
              <span className="aiq-index-row__ticker">{idx.ticker.replace('^', '')}</span>
              <span className="aiq-index-row__price">{idx.price?.toFixed(2)}</span>
              <span className={`aiq-index-row__change ${isUp ? 'positive' : 'negative'}`}>
                {isUp ? '+' : ''}{idx.changePercent?.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* SPY/QQQ Technicals */}
      {technicals && Object.keys(technicals).length > 0 && (
        <div className="aiq-technicals">
          <div className="aiq-section-label">Technicals</div>
          {Object.entries(technicals).map(([sym, t]) => (
            <div key={sym} className="aiq-tech-row">
              <span className="aiq-tech-row__sym">{sym}</span>
              <div className="aiq-tech-row__mas">
                <span className={t.aboveSMA9 ? 'positive' : 'negative'}>9</span>
                <span className={t.aboveSMA20 ? 'positive' : 'negative'}>20</span>
                <span className={t.aboveSMA50 ? 'positive' : 'negative'}>50</span>
              </div>
            </div>
          ))}
          <div className="aiq-tech-legend">
            <span className="positive">●</span> Above SMA
            <span className="negative" style={{ marginLeft: 8 }}>●</span> Below SMA
          </div>
        </div>
      )}

      {/* Sector Performance */}
      <SectorPerformance />
    </div>
  );
}
