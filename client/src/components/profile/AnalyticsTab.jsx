import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Area, AreaChart,
} from 'recharts';
import { authFetch } from '../../utils/api';

const GREEN = 'var(--accent-green)';
const RED = 'var(--accent-red)';
const BLUE = 'var(--accent-blue)';
const MUTED = 'var(--text-muted)';

export default function AnalyticsTab({ scope }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    authFetch(`/api/trades?scope=${scope}&status=closed&limit=500`)
      .then(r => r.json())
      .then(data => { setTrades(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [scope]);

  // Sort trades by closed_at ascending
  const sorted = useMemo(() =>
    [...trades].sort((a, b) => new Date(a.closed_at) - new Date(b.closed_at)),
  [trades]);

  // 1. Cumulative P&L
  const cumPnl = useMemo(() => {
    let running = 0;
    return sorted.map(t => {
      running += +(t.pnl_dollar || 0);
      return { date: t.closed_at?.slice(0, 10), pnl: +running.toFixed(2) };
    });
  }, [sorted]);

  // 2. Win Rate Over Time (rolling 10-trade)
  const winRateData = useMemo(() => {
    const window = 10;
    return sorted.map((t, i) => {
      const start = Math.max(0, i - window + 1);
      const slice = sorted.slice(start, i + 1);
      const wins = slice.filter(s => (s.pnl_dollar || 0) > 0).length;
      return { trade: i + 1, winRate: +((wins / slice.length) * 100).toFixed(1) };
    });
  }, [sorted]);

  // 3. P&L by Setup Type
  const setupData = useMemo(() => {
    const map = {};
    for (const t of sorted) {
      const setup = t.setup_type || 'None';
      if (!map[setup]) map[setup] = { setup, pnl: 0, count: 0 };
      map[setup].pnl += +(t.pnl_dollar || 0);
      map[setup].count++;
    }
    return Object.values(map).sort((a, b) => b.pnl - a.pnl);
  }, [sorted]);

  // 4. Win/Loss Distribution (histogram)
  const distribution = useMemo(() => {
    const bucketSize = 50;
    const map = {};
    for (const t of sorted) {
      const pnl = +(t.pnl_dollar || 0);
      const bucket = Math.floor(pnl / bucketSize) * bucketSize;
      const key = `${bucket}`;
      if (!map[key]) map[key] = { range: bucket, count: 0 };
      map[key].count++;
    }
    return Object.values(map).sort((a, b) => a.range - b.range);
  }, [sorted]);

  // 5. Duration vs P&L (scatter)
  const scatterData = useMemo(() =>
    sorted.filter(t => t.duration_seconds).map(t => ({
      minutes: Math.round(t.duration_seconds / 60),
      pnl: +(t.pnl_dollar || 0),
      symbol: t.symbol,
    })),
  [sorted]);

  // 6. Daily P&L
  const dailyPnl = useMemo(() => {
    const map = {};
    for (const t of sorted) {
      const day = t.closed_at?.slice(0, 10);
      if (!day) continue;
      if (!map[day]) map[day] = { date: day, pnl: 0 };
      map[day].pnl += +(t.pnl_dollar || 0);
    }
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ ...d, pnl: +d.pnl.toFixed(2) }));
  }, [sorted]);

  if (loading) return <div className="muted" style={{ padding: 24 }}>Loading analytics...</div>;
  if (trades.length === 0) return <div className="muted" style={{ padding: 24 }}>No closed trades yet. Seed demo data to see analytics.</div>;

  const chartTheme = { fontSize: 11, fill: MUTED };

  return (
    <div className="analytics-grid">
      {/* 1. Cumulative P&L */}
      <div className="panel chart-panel">
        <h4 className="chart-title">Cumulative P&L</h4>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={cumPnl}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="date" tick={chartTheme} />
            <YAxis tick={chartTheme} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
            <Area type="monotone" dataKey="pnl" stroke={BLUE} fill={BLUE} fillOpacity={0.15} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 2. Win Rate Over Time */}
      <div className="panel chart-panel">
        <h4 className="chart-title">Win Rate (Rolling 10)</h4>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={winRateData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="trade" tick={chartTheme} />
            <YAxis tick={chartTheme} domain={[0, 100]} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
            <Line type="monotone" dataKey="winRate" stroke={GREEN} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 3. P&L by Setup Type */}
      <div className="panel chart-panel">
        <h4 className="chart-title">P&L by Setup Type</h4>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={setupData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="setup" tick={chartTheme} />
            <YAxis tick={chartTheme} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
            <Bar dataKey="pnl">
              {setupData.map((d, i) => (
                <Cell key={i} fill={d.pnl >= 0 ? GREEN : RED} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 4. Win/Loss Distribution */}
      <div className="panel chart-panel">
        <h4 className="chart-title">Win/Loss Distribution</h4>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={distribution}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="range" tick={chartTheme} tickFormatter={v => `$${v}`} />
            <YAxis tick={chartTheme} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
            <Bar dataKey="count">
              {distribution.map((d, i) => (
                <Cell key={i} fill={d.range >= 0 ? GREEN : RED} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 5. Duration vs P&L */}
      <div className="panel chart-panel">
        <h4 className="chart-title">Duration vs P&L</h4>
        <ResponsiveContainer width="100%" height={240}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="minutes" name="Duration (min)" tick={chartTheme} />
            <YAxis dataKey="pnl" name="P&L" tick={chartTheme} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
            <Scatter data={scatterData}>
              {scatterData.map((d, i) => (
                <Cell key={i} fill={d.pnl >= 0 ? GREEN : RED} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* 6. Daily P&L */}
      <div className="panel chart-panel">
        <h4 className="chart-title">Daily P&L</h4>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={dailyPnl}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="date" tick={chartTheme} />
            <YAxis tick={chartTheme} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
            <Bar dataKey="pnl">
              {dailyPnl.map((d, i) => (
                <Cell key={i} fill={d.pnl >= 0 ? GREEN : RED} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
