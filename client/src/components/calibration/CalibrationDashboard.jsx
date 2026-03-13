import { useEffect, useState } from 'react';
import Card from '../shared/Card';
import { fetchCalibrationPerformance } from '../../api/calibrationApi';

export default function CalibrationDashboard() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const payload = await fetchCalibrationPerformance();
        if (cancelled) return;
        setItems(Array.isArray(payload?.items) ? payload.items : []);
      } catch (err) {
        if (cancelled) return;
        setItems([]);
        setError(err?.message || 'Failed to load calibration performance');
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
      <h3 className="m-0 mb-3">Calibration Dashboard</h3>
      {loading ? <div className="muted">Loading calibration performance...</div> : null}
      {!loading && error ? <div className="muted">{error}</div> : null}
      {!loading && !error && items.length === 0 ? <div className="muted">No calibration performance available.</div> : null}
      {!loading && !error && items.length > 0 ? (
        <div className="space-y-2 text-sm">
          {items.map((item) => (
            <div key={String(item?.strategy || 'unknown')} className="rounded border border-[var(--border-color)] p-3">
              <div className="flex items-center justify-between gap-2">
                <strong>{item?.strategy || 'Unknown'}</strong>
                <span className="text-xs text-[var(--text-muted)]">Signals: {Number(item?.total_signals || 0)}</span>
              </div>
              <div className="mt-2 grid gap-1 text-xs text-[var(--text-muted)] md:grid-cols-4">
                <div>Win Rate: {Number(item?.win_rate_percent || 0).toFixed(2)}%</div>
                <div>Average Move: {Number(item?.avg_move || 0).toFixed(2)}%</div>
                <div>Average Drawdown: {Number(item?.avg_drawdown || 0).toFixed(2)}%</div>
                <div>Total Signals: {Number(item?.total_signals || 0)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}