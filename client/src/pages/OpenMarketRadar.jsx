import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';

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

      <div className="grid gap-3 lg:grid-cols-2">
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
                    <td>{String(row?.symbol || '').toUpperCase()}</td>
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
                    <td>{String(row?.symbol || '').toUpperCase()}</td>
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
                  <div className="flex items-center justify-between"><strong>{String(row?.symbol || '').toUpperCase()}</strong><span className="muted">{row?.sentiment || 'neutral'}</span></div>
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
                    <td>{String(row?.symbol || '').toUpperCase()}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.relative_volume || 0).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.price || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
      </div>
    </PageContainer>
  );
}
