import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '@/config/api';
import { SentimentBadge } from '../components/terminal/SignalVisuals';

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function timeAgo(raw) {
  if (!raw) return 'Unknown';
  const now = Date.now();
  const then = new Date(raw).getTime();
  if (Number.isNaN(then)) return 'Unknown';
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function impactScore(item) {
  const base = toNum(item?.news_score, 0);
  if (base >= 85) return 5;
  if (base >= 70) return 4;
  if (base >= 55) return 3;
  if (base >= 35) return 2;
  return 1;
}

export default function NewsScannerV2() {
  const [rows, setRows] = useState([]);
  const [mode, setMode] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const payload = await apiJSON('/api/news/v3?limit=120&sort=score').catch(() => []);
        const list = Array.isArray(payload) ? payload : [];
        if (!cancelled) setRows(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const visibleRows = useMemo(() => {
    const base = rows
      .map((item) => ({
        ...item,
        symbol: String(item?.symbol || '').toUpperCase(),
        impact: impactScore(item),
      }))
      .filter((item) => item.symbol || item.headline)
      .sort((a, b) => toNum(b.news_score, 0) - toNum(a.news_score, 0));

    if (mode === 'SIGNAL') {
      return base.filter((item) => item.impact >= 4 || toNum(item?.expected_move, 0) >= 2.5);
    }

    return base;
  }, [rows, mode]);

  return (
    <div className="space-y-4 bg-slate-950 text-slate-100">
      <section className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Catalyst Scanner</h1>
            <p className="mt-1 text-sm text-slate-400">Headline feed ranked by impact and trade relevance.</p>
          </div>
          <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-1 text-xs font-semibold">
            <button
              type="button"
              className={`rounded px-3 py-1 ${mode === 'ALL' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => setMode('ALL')}
            >
              ALL
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 ${mode === 'SIGNAL' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => setMode('SIGNAL')}
            >
              SIGNAL ONLY
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900 p-3">
        <div className="space-y-2">
          {loading ? <div className="px-2 py-3 text-sm text-slate-400">Loading catalyst feed...</div> : null}

          {!loading && visibleRows.slice(0, 80).map((item, idx) => (
            <article key={`${item?.id || item?.symbol || 'news'}-${idx}`} className="grid grid-cols-12 items-center gap-2 rounded-md border border-slate-700 bg-slate-950 p-2 text-xs">
              <div className="col-span-2 sm:col-span-1 font-semibold text-slate-100">{item.symbol || '--'}</div>

              <div className="col-span-10 sm:col-span-6 truncate text-slate-300" title={item?.headline}>
                {item?.headline || 'No qualifying setups right now'}
              </div>

              <div className="col-span-4 sm:col-span-2">
                <SentimentBadge value={item?.sentiment || 'neutral'} />
              </div>

              <div className="col-span-4 sm:col-span-2">
                <div className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-amber-200">
                  <span>Impact</span>
                  <strong>{item.impact}/5</strong>
                </div>
              </div>

              <div className="col-span-4 sm:col-span-1 text-right text-slate-500">{timeAgo(item?.publishedAt)}</div>
            </article>
          ))}

          {!loading && visibleRows.length === 0 ? <div className="px-2 py-3 text-sm text-slate-500">No qualifying setups right now</div> : null}
        </div>
      </section>
    </div>
  );
}
