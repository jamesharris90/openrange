import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';

function fmt(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

export default function IntelligenceEngine() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ sectors: [], opportunities: [], earnings: { today: [], week: [] }, news: [] });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const payload = await apiJSON('/api/intelligence/summary');
        if (!cancelled) {
          setSummary(payload?.summary || { sectors: [], opportunities: [], earnings: { today: [], week: [] }, news: [] });
        }
      } catch {
        if (!cancelled) {
          setSummary({ sectors: [], opportunities: [], earnings: { today: [], week: [] }, news: [] });
        }
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
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Intelligence Engine"
          subtitle="Unified overview of sectors, opportunities, earnings, and news."
        />
      </Card>

      {loading ? (
        <Card><LoadingSpinner message="Loading intelligence summary…" /></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <h3 className="m-0 mb-3">Top Sectors</h3>
            {summary.sectors?.length ? (
              <table className="data-table data-table--compact">
                <thead><tr><th>Sector</th><th style={{ textAlign: 'right' }}>Avg %</th></tr></thead>
                <tbody>
                  {summary.sectors.slice(0, 5)?.map((row) => (
                    <tr key={row?.sector || 'sector'}>
                      <td>{row?.sector || 'Unknown'}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(row?.avg_change, 2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="muted">No sector summary available.</div>}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Top Opportunities</h3>
            {summary.opportunities?.length ? (
              <table className="data-table data-table--compact">
                <thead><tr><th>Symbol</th><th>Strategy</th><th style={{ textAlign: 'right' }}>Score</th></tr></thead>
                <tbody>
                  {summary.opportunities.slice(0, 10)?.map((row) => (
                    <tr key={row?.symbol || 'opp'}>
                      <td>{String(row?.symbol || '').toUpperCase()}</td>
                      <td>{row?.strategy || '--'}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(row?.score, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="muted">No opportunities available.</div>}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Earnings (Today)</h3>
            {summary.earnings?.today?.length ? (
              <div className="space-y-2 text-sm">
                {summary.earnings.today.slice(0, 8)?.map((row, idx) => (
                  <div key={`${row?.symbol || 'e'}-${idx}`} className="flex items-center justify-between rounded border border-[var(--border-color)] p-2">
                    <strong>{String(row?.symbol || '').toUpperCase()}</strong>
                    <span className="muted">{row?.date || '--'}</span>
                  </div>
                ))}
              </div>
            ) : <div className="muted">No earnings for today.</div>}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">Intel Feed</h3>
            {summary.news?.length ? (
              <div className="space-y-2 text-sm">
                {summary.news.slice(0, 8)?.map((row, idx) => (
                  <a
                    key={`${row?.url || 'n'}-${idx}`}
                    className="block rounded border border-[var(--border-color)] p-2 hover:bg-[var(--bg-card-hover)]"
                    href={row?.url || '#'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong>{String(row?.symbol || '').toUpperCase() || 'MARKET'}</strong>
                      <span className="muted">{row?.sentiment || 'neutral'}</span>
                    </div>
                    <div>{row?.headline || '--'}</div>
                  </a>
                ))}
              </div>
            ) : <div className="muted">No intelligence news available.</div>}
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
