import { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Gauge } from 'lucide-react';
import { radarFetch } from '../../utils/radarFetch';

const POLL_MS = 60000;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trendColor(trend) {
  const t = String(trend || '').toLowerCase();
  if (t === 'bullish') return 'text-emerald-300';
  if (t === 'bearish') return 'text-red-300';
  return 'text-slate-300';
}

function trendIcon(trend) {
  const t = String(trend || '').toLowerCase();
  if (t === 'bullish') return ArrowUpRight;
  if (t === 'bearish') return ArrowDownRight;
  return ArrowRight;
}

function regimeTone(regime) {
  const r = String(regime || '').toLowerCase();
  if (r === 'risk_on') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (r === 'risk_off') return 'border-red-500/40 bg-red-500/10 text-red-300';
  return 'border-slate-500/40 bg-slate-500/10 text-slate-300';
}

function volatilityTone(level) {
  return String(level || '').toLowerCase() === 'high'
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
    : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300';
}

export default function RadarMarketContext() {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError('');

      try {
        const payload = await radarFetch('/api/market-context');
        if (!active || requestId !== requestIdRef.current) return;
        setData(payload?.data && typeof payload.data === 'object' ? payload.data : {});
      } catch (err) {
        if (!active || requestId !== requestIdRef.current) return;
        setData({});
        setError(err?.message || 'Failed to load market context');
      } finally {
        if (active && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    load();
    const timer = setInterval(load, POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
      requestIdRef.current += 1;
    };
  }, []);

  const breadth = Math.max(0, Math.min(100, toNumber(data.breadth_percent, 0)));
  const SpyTrendIcon = trendIcon(data.spy_trend);
  const QqqTrendIcon = trendIcon(data.qqq_trend);

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Gauge size={16} className="text-cyan-300" />
        <h3 className="m-0 text-base font-semibold text-[var(--text-primary)]">Market Context</h3>
      </div>

      {loading ? <div className="text-sm text-[var(--text-muted)]">Loading...</div> : null}
      {!loading && error ? <div className="text-sm text-red-300">{error}</div> : null}

      {!loading && !error ? (
        <>
          <div className="grid gap-2 md:grid-cols-5">
            <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">SPY Trend</div>
              <div className={`mt-1 flex items-center gap-1 text-sm font-semibold ${trendColor(data.spy_trend)}`}>
                <SpyTrendIcon size={14} />
                <span>{data.spy_trend || 'neutral'}</span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">QQQ Trend</div>
              <div className={`mt-1 flex items-center gap-1 text-sm font-semibold ${trendColor(data.qqq_trend)}`}>
                <QqqTrendIcon size={14} />
                <span>{data.qqq_trend || 'neutral'}</span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Market Regime</div>
              <div className={`mt-1 inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${regimeTone(data.market_regime)}`}>
                {data.market_regime || 'neutral'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Volatility</div>
              <div className={`mt-1 inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${volatilityTone(data.volatility_level)}`}>
                {data.volatility_level || 'normal'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Breadth</div>
              <div className="mt-1 text-sm font-semibold text-cyan-300">{breadth.toFixed(1)}%</div>
            </div>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-emerald-400 transition-all duration-500"
              style={{ width: `${breadth}%` }}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
              <span className="opacity-80">Strongest Sector</span>
              <span className="font-semibold">{data.strongest_sector || 'n/a'}</span>
            </div>
            <div className="inline-flex items-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300">
              <span className="opacity-80">Weakest Sector</span>
              <span className="font-semibold">{data.weakest_sector || 'n/a'}</span>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
