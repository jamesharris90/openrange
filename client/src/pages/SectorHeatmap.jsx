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

export default function SectorHeatmap() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const payload = await apiJSON('/api/market/sectors');
        const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
        if (!cancelled) setRows(sectors);
      } catch {
        if (!cancelled) setRows([]);
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
          title="Sector Heatmap"
          subtitle="Live sector strength and top leaders from the sector engine."
        />
      </Card>

      <Card>
        {loading ? (
          <LoadingSpinner message="Loading sectors…" />
        ) : rows.length === 0 ? (
          <div className="muted">No sector heatmap data available.</div>
        ) : (
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Sector</th>
                <th style={{ textAlign: 'right' }}>Avg %</th>
                <th style={{ textAlign: 'right' }}>Stocks</th>
                <th style={{ textAlign: 'right' }}>Volume</th>
                <th>Leaders</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const leaders = Array.isArray(row?.leaders) ? row.leaders : [];
                return (
                  <tr key={row?.sector || 'unknown'}>
                    <td>{row?.sector || 'Unknown'}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(row?.avg_change_percent, 2)}%</td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.symbols || 0)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row?.total_volume || 0).toLocaleString()}</td>
                    <td>
                      {leaders.length
                        ? leaders.map((item) => `${item?.symbol || '--'} (${fmt(item?.change_percent, 2)}%)`).join(', ')
                        : '--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </PageContainer>
  );
}
