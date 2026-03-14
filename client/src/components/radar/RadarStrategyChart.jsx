import { useEffect, useMemo, useRef, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { radarFetch } from '../../utils/radarFetch';

const POLL_MS = 60000;
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#14b8a6', '#a855f7', '#84cc16'];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function RadarStrategyChart() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError('');

      try {
        const payload = await radarFetch('/api/system/strategies');
        if (!active || requestId !== requestIdRef.current) return;

        const items = Array.isArray(payload?.items) ? payload.items : [];
        setRows(items.slice(0, 8));
      } catch (err) {
        if (!active || requestId !== requestIdRef.current) return;
        setRows([]);
        setError(err?.message || 'Failed to load strategy distribution');
      } finally {
        if (active && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    load();
    const timer = setInterval(load, POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
      requestIdRef.current += 1;
    };
  }, []);

  const data = useMemo(
    () => rows.map((row) => ({ name: row.strategy || 'unknown', value: toNumber(row.signals) })),
    [rows]
  );

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="m-0 text-base font-semibold text-[var(--text-primary)]">Strategy Distribution</h3>
        <span className="text-xs text-[var(--text-muted)]">Current snapshot</span>
      </div>
      <p className="mb-3 text-xs text-[var(--text-muted)]">Chart displays currently active strategy mix.</p>

      {loading ? <div className="text-sm text-[var(--text-muted)]">Loading...</div> : null}
      {!loading && error ? <div className="text-sm text-red-300">{error}</div> : null}

      {!loading && !error ? (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                {data.map((entry, idx) => (
                  <Cell key={`${entry.name}-${idx}`} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                labelStyle={{ color: '#e2e8f0' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </section>
  );
}
