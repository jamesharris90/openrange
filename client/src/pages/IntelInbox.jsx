import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import SkeletonCard from '../components/ui/SkeletonCard';
import { apiJSON } from '../config/api';
import TickerLink from '../components/shared/TickerLink';
import MiniSymbolChart from '../components/charts/MiniSymbolChart';

export default function IntelInbox() {
  const [selectedSymbol, setSelectedSymbol] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        let url = '/api/intelligence/news?hours=24';
        if (selectedSymbol && selectedSymbol !== 'ALL') {
          url += `&symbol=${encodeURIComponent(selectedSymbol)}`;
        }
        const payload = await apiJSON(url);
        if (!cancelled) setItems(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Intel Inbox"
          subtitle={`Filtered intelligence news feed with sentiment and sector context for ${selectedSymbol}.`}
        />
      </Card>

      <Card>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="intel-symbol-filter" className="muted">Symbol filter:</label>
          <select
            id="intel-symbol-filter"
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(String(e.target.value || 'ALL').toUpperCase())}
            className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1"
          >
            <option value="ALL">ALL</option>
            <option value="SPY">SPY</option>
            <option value="QQQ">QQQ</option>
            <option value="IWM">IWM</option>
            <option value="DIA">DIA</option>
          </select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <div className="grid gap-2">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </div>
        ) : items.length === 0 ? (
          <div className="muted">No intelligence news available.</div>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => (
              <a
                key={`${item?.url || 'n'}-${index}`}
                href={item?.url || '#'}
                target="_blank"
                rel="noreferrer"
                className="block rounded border border-[var(--border-color)] p-2 text-sm hover:bg-[var(--bg-card-hover)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <TickerLink symbol={String(item?.symbol || 'MARKET').toUpperCase()} />
                  <span className="muted">{item?.sentiment || 'neutral'}</span>
                </div>
                <div>{item?.headline || '--'}</div>
                <div className="muted text-xs">{item?.sector || 'Unknown sector'} • {item?.source || 'Unknown source'}</div>
                <div className="mt-1">
                  <MiniSymbolChart symbol={String(item?.symbol || '').toUpperCase()} />
                </div>
              </a>
            ))}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
