import { useEffect, useState } from 'react';
import Card from './shared/Card';
import { apiJSON } from '../config/api';

function fmt(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '--';
}

export default function DashboardTopSignals() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const payload = await apiJSON('/api/newsletter/preview');
        if (cancelled) return;
        const items = Array.isArray(payload?.payload?.topSignals) ? payload.payload.topSignals : [];
        setRows(items.slice(0, 10));
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
    <Card>
      <h3 className="m-0 mb-3">Top Signals</h3>
      {loading ? (
        <div className="muted text-sm">Loading top signals...</div>
      ) : !rows.length ? (
        <div className="muted text-sm">No top signals available.</div>
      ) : (
        <div className="overflow-auto">
          <table className="data-table data-table--compact min-w-[760px]">
            <thead>
              <tr>
                <th>Symbol</th>
                <th style={{ textAlign: 'right' }}>Score</th>
                <th>Tier</th>
                <th>Catalyst</th>
                <th>Sector</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((row) => (
                <tr key={String(row?.symbol || Math.random())}>
                  <td>{row?.symbol || '--'}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(row?.score)}</td>
                  <td>{row?.signal_class || '--'}</td>
                  <td>{row?.catalyst || '--'}</td>
                  <td>{row?.sector || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
