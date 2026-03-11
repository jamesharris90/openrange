import { useEffect, useState } from 'react';
import Card from './shared/Card';
import { apiJSON } from '../config/api';

export default function DashboardNews() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const payload = await apiJSON('/api/intelligence/catalysts?limit=5');
        if (cancelled) return;
        setItems(Array.isArray(payload?.items) ? payload.items.slice(0, 5) : []);
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
  }, []);

  return (
    <Card>
      <h3 className="m-0 mb-3">Top Catalysts</h3>
      {loading ? (
        <div className="muted text-sm">Loading catalysts...</div>
      ) : !items.length ? (
        <div className="muted text-sm">No catalysts available.</div>
      ) : (
        <div className="space-y-2 text-sm">
          {items?.map((row, idx) => (
            <div key={`${row?.symbol || 'x'}-${idx}`} className="rounded border border-[var(--border-color)] p-2">
              <div className="flex items-center justify-between">
                <strong>{row?.symbol || '--'}</strong>
                <span className="muted">{row?.catalyst_type || 'unknown'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
