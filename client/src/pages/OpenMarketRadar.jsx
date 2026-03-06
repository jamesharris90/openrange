import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import OpportunityStream from '../components/opportunity/OpportunityStream';
import { apiJSON } from '../config/api';
import ScrollingTicker from '../components/market/ScrollingTicker';
import MarketPulseCards from '../components/market/MarketPulseCards';
import TickerLink from '../components/shared/TickerLink';

function parseNarrativeText(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const drivers = [];
  let section = '';

  lines.forEach((line) => {
    if (line === 'Drivers:') {
      section = 'drivers';
      return;
    }
    if (line === 'Top Opportunities:') {
      section = 'opportunities';
      return;
    }
    if (line.startsWith('Market Regime:')) return;
    if (section === 'drivers') drivers.push(line);
  });

  return { drivers };
}

function Panel({ title, loading, rows, emptyMessage, render }) {
  return (
    <Card>
      <h3 className="m-0 mb-3">{title}</h3>
      {loading ? (
        <LoadingSpinner message={`Loading ${title.toLowerCase()}…`} />
      ) : rows.length === 0 ? (
        <div className="muted">{emptyMessage}</div>
      ) : (
        render(rows)
      )}
    </Card>
  );
}

export default function OpenMarketRadar() {
  const [scanner, setScanner] = useState({ loading: true, rows: [] });
  const [setups, setSetups] = useState({ loading: true, rows: [] });
  const [catalysts, setCatalysts] = useState({ loading: true, rows: [] });
  const [metrics, setMetrics] = useState({ loading: true, rows: [] });
  const [narrative, setNarrative] = useState(null);
  const [signals, setSignals] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/scanner');
        const rows = Array.isArray(payload) ? payload : [];
        rows.sort((a, b) => Number(b?.relative_volume || 0) - Number(a?.relative_volume || 0));
        if (!cancelled) setScanner({ loading: false, rows });
      } catch {
        if (!cancelled) setScanner({ loading: false, rows: [] });
      }

      try {
        const payload = await apiJSON('/api/setups');
        if (!cancelled) setSetups({ loading: false, rows: Array.isArray(payload) ? payload : [] });
      } catch {
        if (!cancelled) setSetups({ loading: false, rows: [] });
      }

      try {
        const payload = await apiJSON('/api/catalysts');
        if (!cancelled) setCatalysts({ loading: false, rows: Array.isArray(payload) ? payload : [] });
      } catch {
        if (!cancelled) setCatalysts({ loading: false, rows: [] });
      }

      try {
        const payload = await apiJSON('/api/metrics');
        const rows = Array.isArray(payload) ? payload : [];
        rows.sort((a, b) => Number(b?.relative_volume || 0) - Number(a?.relative_volume || 0));
        if (!cancelled) setMetrics({ loading: false, rows });
      } catch {
        if (!cancelled) setMetrics({ loading: false, rows: [] });
      }

      try {
        const payload = await apiJSON('/api/market-narrative');
        if (!cancelled) setNarrative(payload && typeof payload === 'object' ? payload : null);
      } catch {
        if (!cancelled) setNarrative(null);
      }

      try {
        const payload = await apiJSON('/api/signals');
        if (!cancelled) setSignals(Array.isArray(payload?.signals) ? payload.signals : []);
      } catch {
        if (!cancelled) setSignals([]);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Open Market Radar"
          subtitle="Live market action board across momentum, strategy, catalyst, and volume signals."
        />
      </Card>

      <ScrollingTicker />
      <MarketPulseCards />

      <Card>
        <h3 className="m-0 mb-3">Market Narrative</h3>
        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded border border-[var(--border-color)] p-3">
            <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Market Regime</div>
            <div className="mt-1 text-lg font-semibold">{narrative?.regime || 'Unknown'}</div>
          </div>
          <div className="rounded border border-[var(--border-color)] p-3">
            <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Drivers</div>
            <div className="mt-1 space-y-1 text-sm">
              {parseNarrativeText(narrative?.narrative).drivers.slice(0, 3).map((driver, idx) => (
                <div key={`drv-${idx}`}>⚡ Catalyst {driver}</div>
              ))}
              {!parseNarrativeText(narrative?.narrative).drivers.length && <div className="muted">No drivers</div>}
            </div>
          </div>
          <div className="rounded border border-[var(--border-color)] p-3">
            <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Top Strategies</div>
            <div className="mt-1 space-y-1 text-sm">
              {signals.slice(0, 3).map((item, idx) => {
                const icon = idx === 0 ? '🔥' : idx === 1 ? '📈' : '⚡';
                return <div key={`${item?.symbol}-${idx}`}>{icon} {item?.strategy || '--'} · {String(item?.symbol || '').toUpperCase()}</div>;
              })}
              {!signals.length && <div className="muted">No strategy rows</div>}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
        <Panel
          title="Momentum Leaders"
          loading={scanner.loading}
          rows={scanner.rows}
          emptyMessage="No momentum leaders available."
          render={(rows) => (
            <table className="data-table data-table--compact">
              <thead><tr><th>Ticker</th><th style={{ textAlign: 'right' }}>RVol</th><th style={{ textAlign: 'right' }}>Gap %</th></tr></thead>
              <tbody>
                {rows.slice(0, 12).map((row) => (
                  <tr key={`${row?.symbol}-${row?.setup || ''}`}>
                    <td><TickerLink symbol={row?.symbol} /></td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.relative_volume || 0).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.gap_percent || 0).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />

        <Panel
          title="Strategy Signals"
          loading={setups.loading}
          rows={setups.rows}
          emptyMessage="No strategy signals available."
          render={(rows) => (
            <table className="data-table data-table--compact">
              <thead><tr><th>Ticker</th><th>Setup</th><th style={{ textAlign: 'right' }}>Score</th></tr></thead>
              <tbody>
                {rows.slice(0, 12).map((row) => (
                  <tr key={`${row?.symbol}-${row?.setup || row?.setup_type || ''}`}>
                    <td><TickerLink symbol={row?.symbol} /></td>
                    <td>{row?.setup_type || row?.setup || '--'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.score || 0).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />

        <Panel
          title="Catalyst Alerts"
          loading={catalysts.loading}
          rows={catalysts.rows}
          emptyMessage="No catalyst alerts available."
          render={(rows) => (
            <div className="space-y-2">
              {rows.slice(0, 10).map((row, idx) => (
                  <div key={`${row?.symbol || idx}-${row?.published_at || idx}`} className="rounded border border-[var(--border-color)] p-2 text-sm">
                  <div className="flex items-center justify-between"><TickerLink symbol={row?.symbol} /><span className="muted">{row?.sentiment || 'neutral'}</span></div>
                  <div>{row?.headline || '--'}</div>
                </div>
              ))}
            </div>
          )}
        />

        <Panel
          title="Volume Surges"
          loading={metrics.loading}
          rows={metrics.rows}
          emptyMessage="No volume surge rows available."
          render={(rows) => (
            <table className="data-table data-table--compact">
              <thead><tr><th>Ticker</th><th style={{ textAlign: 'right' }}>RVol</th><th style={{ textAlign: 'right' }}>Price</th></tr></thead>
              <tbody>
                {rows.slice(0, 12).map((row) => (
                  <tr key={row?.symbol}>
                    <td><TickerLink symbol={row?.symbol} /></td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.relative_volume || 0).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.price || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
        </div>

        <Card>
          <h3 className="m-0 mb-3">Opportunity Stream</h3>
          <OpportunityStream />
        </Card>
      </div>
    </PageContainer>
  );
}
