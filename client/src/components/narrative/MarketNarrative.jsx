import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';
import LoadingSpinner from '../shared/LoadingSpinner';

function parseNarrativeText(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const drivers = [];
  const opportunities = [];
  let section = '';

  lines.forEach((line) => {
    if (line.startsWith('Market Regime:')) return;
    if (line === 'Drivers:') {
      section = 'drivers';
      return;
    }
    if (line === 'Top Opportunities:') {
      section = 'opportunities';
      return;
    }

    if (section === 'drivers') drivers.push(line);
    if (section === 'opportunities') opportunities.push(line);
  });

  return { drivers, opportunities };
}

export default function MarketNarrative() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await apiJSON('/api/market-narrative');
        if (!cancelled) setPayload(data || null);
      } catch {
        if (!cancelled) setPayload(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const parsed = useMemo(() => parseNarrativeText(payload?.narrative), [payload]);

  if (loading) return <LoadingSpinner message="Loading market narrative…" />;
  if (!payload) return <div className="muted">No market narrative available.</div>;

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="muted">Market Regime</div>
        <div style={{ fontWeight: 700 }}>{payload?.regime || 'Unknown'}</div>
      </div>

      <div>
        <div className="muted" style={{ marginBottom: 6 }}>Drivers</div>
        {parsed.drivers.length === 0 ? (
          <div className="muted">No active drivers listed.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {parsed.drivers.map((item, idx) => <li key={`drv-${idx}`}>{item}</li>)}
          </ul>
        )}
      </div>

      <div>
        <div className="muted" style={{ marginBottom: 6 }}>Top Opportunities</div>
        {parsed.opportunities.length === 0 ? (
          <div className="muted">No opportunities listed.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {parsed.opportunities.map((item, idx) => <li key={`opp-${idx}`}>{item}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
