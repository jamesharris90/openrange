import { useEffect, useMemo, useState } from 'react';
import Card from '../ui/Card';
import { apiJSON } from '../../config/api';
import { useSymbol } from '../../context/SymbolContext';

const KEYWORDS = ['FDA', 'earnings', 'upgrade', 'acquisition'];

function sentimentClass(sentiment) {
  const value = String(sentiment || '').toLowerCase();
  if (value.includes('bull')) return 'text-emerald-400';
  if (value.includes('bear')) return 'text-rose-400';
  return 'text-slate-400';
}

function highlightKeywords(text) {
  const value = String(text || '');
  if (!value) return '--';
  const regex = new RegExp(`(${KEYWORDS.join('|')})`, 'ig');
  return value.split(regex).map((part, index) => {
    const hit = KEYWORDS.some((word) => word.toLowerCase() === part.toLowerCase());
    return hit
      ? <mark key={`${part}-${index}`} className="rounded bg-amber-300/30 px-1 text-amber-200">{part}</mark>
      : <span key={`${part}-${index}`}>{part}</span>;
  });
}

export default function NewsPanel() {
  const { selectedSymbol } = useSymbol();
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON(`/api/intelligence/news?symbol=${encodeURIComponent(selectedSymbol)}&hours=48`);
        const list = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
        if (!cancelled) setItems(list.slice(0, 15));
      } catch {
        if (!cancelled) setItems([]);
      }
    }

    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedSymbol]);

  const rows = useMemo(() => items.slice(0, 8), [items]);

  return (
    <Card className="h-full p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">News</h3>
        <span className="text-xs text-[var(--text-muted)]">{selectedSymbol}</span>
      </div>

      <div className="space-y-2">
        {rows.map((item, index) => (
          <article key={`${item?.url || 'news'}-${index}`} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3 text-xs">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-[var(--text-secondary)]">{item?.source || 'source'}</span>
              <span className={sentimentClass(item?.sentiment)}>{item?.sentiment || 'neutral'}</span>
            </div>
            <div className="text-sm text-[var(--text-primary)]">{highlightKeywords(item?.headline)}</div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">
              {item?.timestamp || item?.published_at ? new Date(item?.timestamp || item?.published_at).toLocaleString() : '--'}
            </div>
          </article>
        ))}
        {!rows.length && <div className="text-xs text-[var(--text-muted)]">No intelligence news for this symbol.</div>}
      </div>
    </Card>
  );
}
