import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react';
import useMarketContext from '../../hooks/useMarketContext';

const BIAS_CONFIG = {
  bullish: { icon: TrendingUp, color: 'var(--accent-green)', label: 'BULL' },
  bearish: { icon: TrendingDown, color: 'var(--accent-red)', label: 'BEAR' },
  neutral: { icon: Minus, color: 'var(--accent-orange)', label: 'NEUTRAL' },
};

function SectorPills() {
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);

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

  if (loading || !sectors.length) return null;

  return (
    <div className="aiq-strip__sectors">
      {sectors.map(s => {
        const isUp = s.changePercent >= 0;
        return (
          <span key={s.etf} className={`aiq-strip__sector-pill ${isUp ? 'positive' : 'negative'}`}
            title={`${s.sector} (${s.etf}): ${isUp ? '+' : ''}${s.changePercent.toFixed(2)}%`}>
            <span className="aiq-strip__sector-name">{s.etf}</span>
            <span className="aiq-strip__sector-chg">{isUp ? '+' : ''}{s.changePercent.toFixed(2)}%</span>
          </span>
        );
      })}
    </div>
  );
}

export default function MarketContextStrip() {
  const { data, loading, error, refresh } = useMarketContext();

  if (loading) return <div className="aiq-strip aiq-strip--loading">Loading market data…</div>;
  if (error || !data) return null;

  const { indices, bias, biasReasons, technicals } = data;
  const cfg = BIAS_CONFIG[bias] || BIAS_CONFIG.neutral;
  const BiasIcon = cfg.icon;

  return (
    <div className="aiq-strip">
      {/* Bias Badge */}
      <div className="aiq-strip__bias" style={{ color: cfg.color }} title={biasReasons?.join(' | ') || ''}>
        <BiasIcon size={14} />
        <span>{cfg.label}</span>
      </div>

      {/* Major Indices */}
      <div className="aiq-strip__indices">
        {(indices || []).map(idx => {
          if (idx.error) return null;
          const isUp = idx.changePercent >= 0;
          return (
            <div key={idx.ticker} className="aiq-strip__index">
              <span className="aiq-strip__index-ticker">{idx.ticker.replace('^', '')}</span>
              <span className="aiq-strip__index-price">{idx.price?.toFixed(2)}</span>
              <span className={`aiq-strip__index-chg ${isUp ? 'positive' : 'negative'}`}>
                {isUp ? '+' : ''}{idx.changePercent?.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Technicals */}
      {technicals && Object.keys(technicals).length > 0 && (
        <div className="aiq-strip__technicals">
          {Object.entries(technicals).map(([sym, t]) => (
            <div key={sym} className="aiq-strip__tech-item" title={`${sym} SMA alignment`}>
              <span className="aiq-strip__tech-sym">{sym}</span>
              <span className={t.aboveSMA9 ? 'positive' : 'negative'}>9</span>
              <span className={t.aboveSMA20 ? 'positive' : 'negative'}>20</span>
              <span className={t.aboveSMA50 ? 'positive' : 'negative'}>50</span>
            </div>
          ))}
        </div>
      )}

      {/* Divider */}
      <div className="aiq-strip__divider" />

      {/* Sector Pills */}
      <SectorPills />

      {/* Refresh */}
      <button className="aiq-icon-btn aiq-strip__refresh" onClick={refresh} title="Refresh">
        <RefreshCw size={12} />
      </button>
    </div>
  );
}
