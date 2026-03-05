import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';

export default function EarningsCalendar() {
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState([]);
  const [week, setWeek] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [todayPayload, weekPayload] = await Promise.all([
          apiJSON('/api/earnings/today'),
          apiJSON('/api/earnings/week'),
        ]);

        if (!cancelled) {
          setToday(Array.isArray(todayPayload?.earnings) ? todayPayload.earnings : []);
          setWeek(Array.isArray(weekPayload?.earnings) ? weekPayload.earnings : []);
        }
      } catch {
        if (!cancelled) {
          setToday([]);
          setWeek([]);
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

  const renderRows = (rows) => (
    <table className="data-table data-table--compact">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Company</th>
          <th>Date</th>
          <th style={{ textAlign: 'right' }}>EPS Est</th>
          <th style={{ textAlign: 'right' }}>Revenue Est</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row?.symbol || 'row'}-${row?.date || index}`}>
            <td>{String(row?.symbol || '').toUpperCase()}</td>
            <td>{row?.company || '--'}</td>
            <td>{row?.date || '--'}</td>
            <td style={{ textAlign: 'right' }}>{row?.eps_estimate ?? '--'}</td>
            <td style={{ textAlign: 'right' }}>{row?.revenue_estimate ?? '--'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Earnings Calendar"
          subtitle="Today and 7-day earnings schedule from the earnings engine."
        />
      </Card>

      {loading ? (
        <Card><LoadingSpinner message="Loading earnings calendar…" /></Card>
      ) : (
        <>
          <Card>
            <h3 className="m-0 mb-3">Today</h3>
            {today.length ? renderRows(today) : <div className="muted">No earnings scheduled for today.</div>}
          </Card>

          <Card>
            <h3 className="m-0 mb-3">This Week</h3>
            {week.length ? renderRows(week) : <div className="muted">No earnings events in the next 7 days.</div>}
          </Card>
        </>
      )}
    </PageContainer>
  );
}
