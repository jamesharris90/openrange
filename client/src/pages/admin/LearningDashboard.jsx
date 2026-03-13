import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { apiClient } from '../../api/apiClient';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function LearningDashboard() {
  const [strategies, setStrategies] = useState([]);
  const [capture, setCapture] = useState([]);
  const [expectedMove, setExpectedMove] = useState([]);
  const [regime, setRegime] = useState([]);

  useEffect(() => {
    let active = true;

    async function load() {
      const [s, c, e, r] = await Promise.all([
        apiClient('/admin/learning/strategies').catch(() => ({ items: [] })),
        apiClient('/admin/learning/capture-rate').catch(() => ({ items: [] })),
        apiClient('/admin/learning/expected-move').catch(() => ({ items: [] })),
        apiClient('/admin/learning/regime').catch(() => ({ items: [] })),
      ]);

      if (!active) return;
      setStrategies(Array.isArray(s?.items) ? s.items : []);
      setCapture(Array.isArray(c?.items) ? c.items : []);
      setExpectedMove(Array.isArray(e?.items) ? e.items : []);
      setRegime(Array.isArray(r?.items) ? r.items : []);
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const captureSeries = useMemo(() => [...capture].reverse().map((row) => ({
    date: row.date,
    capture_rate: toNum(row.capture_rate) * 100,
    total_opportunities: toNum(row.total_opportunities),
    signals_detected: toNum(row.signals_detected),
  })), [capture]);

  const expectedSeries = useMemo(() => [...expectedMove].reverse().map((row) => ({
    date: row.date,
    hit_rate: toNum(row.hit_rate) * 100,
    avg_expected_move_percent: toNum(row.avg_expected_move_percent),
    avg_actual_move_percent: toNum(row.avg_actual_move_percent),
  })), [expectedMove]);

  const latestRegime = regime[0] || null;

  return (
    <div style={{ padding: 20, display: 'grid', gap: 16 }}>
      <h1>Learning Dashboard</h1>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Market Regime Summary</h3>
        <div>Regime: {latestRegime?.market_regime || 'n/a'}</div>
        <div>SPY Trend: {latestRegime?.spy_trend || 'n/a'}</div>
        <div>VIX: {toNum(latestRegime?.vix_level).toFixed(2)}</div>
        <div>Breadth: {toNum(latestRegime?.breadth_percent).toFixed(2)}%</div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Capture Rate Trend</h3>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={captureSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="capture_rate" stroke="#1976d2" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Expected Move Accuracy</h3>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={expectedSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="hit_rate" stroke="#2e7d32" strokeWidth={2} />
              <Line type="monotone" dataKey="avg_expected_move_percent" stroke="#ef6c00" strokeWidth={2} />
              <Line type="monotone" dataKey="avg_actual_move_percent" stroke="#6a1b9a" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Strategy Edge Ranking</h3>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={strategies.slice(0, 10)} layout="vertical" margin={{ left: 24, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="strategy" width={120} />
              <Tooltip />
              <Bar dataKey="edge_score" fill="#8e24aa" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
