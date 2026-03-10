import { useMemo } from 'react';

function tone(value) {
  const n = Number(value || 0);
  if (n > 0.05) return { icon: '▲', label: 'Bullish', cls: 'text-emerald-400' };
  if (n < -0.05) return { icon: '▼', label: 'Bearish', cls: 'text-rose-400' };
  return { icon: '•', label: 'Neutral', cls: 'text-amber-300' };
}

export default function MarketRegimePanel({ marketContext, narrative }) {
  const spyVwap = useMemo(() => {
    const label = marketContext?.drivers?.find((d) => String(d?.label || '').toLowerCase().includes('spy vs vwap'))?.value || '0';
    const value = Number(String(label).replace('%', '').replace('+', '').trim());
    return Number.isFinite(value) ? value : 0;
  }, [marketContext]);

  const vix = useMemo(() => {
    const label = marketContext?.drivers?.find((d) => String(d?.label || '').toLowerCase().includes('vix'))?.value || '0';
    const value = Number(String(label).replace('%', '').replace('+', '').trim());
    return Number.isFinite(value) ? value : 0;
  }, [marketContext]);

  const sector = marketContext?.drivers?.find((d) => String(d?.label || '').toLowerCase().includes('sector'))?.value || 'Unavailable';
  const spyTone = tone(spyVwap);
  const vixTone = vix <= 0 ? { icon: '▼', label: 'Falling', cls: 'text-emerald-400' } : { icon: '▲', label: 'Rising', cls: 'text-rose-400' };

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <h3 className="m-0 mb-3 text-sm font-semibold">Market Regime</h3>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="text-xs text-[var(--text-muted)]">SPY vs VWAP</div>
          <div className={`text-sm font-semibold ${spyTone.cls}`}>{spyTone.icon} {spyTone.label}</div>
        </div>
        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="text-xs text-[var(--text-muted)]">VIX Trend</div>
          <div className={`text-sm font-semibold ${vixTone.cls}`}>{vixTone.icon} {vixTone.label}</div>
        </div>
        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="text-xs text-[var(--text-muted)]">Sector Strength</div>
          <div className="text-sm font-semibold">{sector}</div>
        </div>
        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="text-xs text-[var(--text-muted)]">Market Sentiment</div>
          <div className="text-sm font-semibold">{narrative?.sentiment || marketContext?.regime || 'Neutral'}</div>
        </div>
      </div>
      <div className="mt-3 rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-sm">
        <div className="text-xs text-[var(--text-muted)]">MCP Market Narrative</div>
        <div>{narrative?.narrative || 'Narrative unavailable.'}</div>
      </div>
    </div>
  );
}
