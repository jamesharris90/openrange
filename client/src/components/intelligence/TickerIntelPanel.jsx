import { useEffect, useState } from 'react';
import { apiJSON } from '../../config/api';

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export default function TickerIntelPanel({ symbol, open, onClose, onOpenSetup }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!open || !symbol) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [news, signal] = await Promise.all([
          apiJSON(`/api/intelligence/news?symbol=${encodeURIComponent(symbol)}&hours=48`).catch(() => ({ items: [] })),
          apiJSON(`/api/signals/${encodeURIComponent(symbol)}/score`).catch(() => ({ item: null })),
        ]);

        if (cancelled) return;

        const sentimentMap = { bullish: 1, positive: 1, neutral: 0, negative: -1, bearish: -1 };
        const sentimentScore = (news.items || []).reduce((acc, row) => acc + (sentimentMap[String(row?.sentiment || '').toLowerCase()] || 0), 0);
        const headlineCount = Math.max(1, (news.items || []).length);
        const normalizedSentiment = sentimentScore / headlineCount;
        const breakdown = signal?.item?.score_breakdown || {};

        setData({
          symbol: String(symbol || '').toUpperCase(),
          sentiment: normalizedSentiment,
          catalystSummary: (news.items || []).slice(0, 3)?.map((row) => row?.headline).filter(Boolean),
          volumeSurge: toNum(breakdown?.rvol_score, 0) / 7,
          shortInterest: 'N/A',
          setups: [
            { key: 'vwap_reclaim', label: 'VWAP reclaim' },
            { key: 'momentum_continuation', label: 'Momentum continuation' },
            { key: 'breakout_watch', label: 'Breakout watch' },
          ],
          narrativeStrength: Math.min(1, toNum(signal?.item?.score, 0) / 120),
          momentum: toNum(breakdown?.momentum_signal_score, toNum(breakdown?.confirmation_score, 0)),
        });
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, symbol]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded border border-[var(--border-color)] bg-[var(--bg-primary)] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="m-0 text-base">{String(symbol || '').toUpperCase()} Ticker Intel</h3>
          <button type="button" className="rounded border border-[var(--border-color)] px-2 py-1 text-xs" onClick={onClose}>Close</button>
        </div>

        {loading ? (
          <div className="muted text-sm">Loading ticker intelligence...</div>
        ) : !data ? (
          <div className="muted text-sm">No ticker intelligence data available.</div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded border border-[var(--border-color)] p-2">
                <div className="muted text-xs">Narrative Strength</div>
                <div className="text-lg font-semibold">{(data?.narrativeStrength * 100).toFixed(0)}%</div>
              </div>
              <div className="rounded border border-[var(--border-color)] p-2">
                <div className="muted text-xs">Volume Spike</div>
                <div className="text-lg font-semibold">{data?.volumeSurge.toFixed(2)}x</div>
              </div>
              <div className="rounded border border-[var(--border-color)] p-2">
                <div className="muted text-xs">Ticker Sentiment</div>
                <div className="text-lg font-semibold">{data?.sentiment.toFixed(2)}</div>
              </div>
              <div className="rounded border border-[var(--border-color)] p-2">
                <div className="muted text-xs">Momentum Score</div>
                <div className="text-lg font-semibold">{data?.momentum >= 8 ? 'strong' : data?.momentum >= 4 ? 'moderate' : 'weak'}</div>
              </div>
            </div>

            <div className="rounded border border-[var(--border-color)] p-2">
              <div className="muted mb-1 text-xs">Catalyst Summary</div>
              {data?.catalystSummary.length ? (
                <ul className="list-disc pl-5">
                  {data?.catalystSummary?.map((item, idx) => <li key={`${idx}-${item}`}>{item}</li>)}
                </ul>
              ) : (
                <div className="muted text-xs">No catalyst summary available.</div>
              )}
            </div>

            <div className="rounded border border-[var(--border-color)] p-2">
              <div className="muted mb-2 text-xs">Trade Setups</div>
              <div className="flex flex-wrap gap-2">
                {data?.setups?.map((setup) => (
                  <button
                    key={setup.key}
                    type="button"
                    className="rounded border border-[var(--border-color)] px-2 py-1 text-xs hover:bg-[var(--bg-card-hover)]"
                    onClick={() => onOpenSetup?.(setup)}
                  >
                    {setup.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
