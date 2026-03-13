import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from 'recharts';
import { apiClient } from '../../api/apiClient';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function CalibrationDashboard() {
  const [daily, setDaily] = useState([]);
  const [weekly, setWeekly] = useState([]);
  const [missed, setMissed] = useState([]);
  const [learning, setLearning] = useState(null);
  const [weights, setWeights] = useState([]);

  useEffect(() => {
    let active = true;
    async function load() {
      const [dailyData, weeklyData, missedData, learningData, weightData] = await Promise.all([
        apiClient('/admin/validation/daily').catch(() => ({ items: [] })),
        apiClient('/admin/validation/weekly').catch(() => ({ items: [] })),
        apiClient('/admin/validation/missed').catch(() => ({ items: [] })),
        apiClient('/admin/validation/learning-score').catch(() => null),
        apiClient('/calibration/strategy-weights').catch(() => ({ items: [] })),
      ]);

      if (!active) return;
      setDaily(Array.isArray(dailyData?.items) ? dailyData.items : []);
      setWeekly(Array.isArray(weeklyData?.items) ? weeklyData.items : []);
      setMissed(Array.isArray(missedData?.items) ? missedData.items : []);
      setLearning(learningData || null);
      setWeights(Array.isArray(weightData?.items) ? weightData.items : []);
    }

    load();
  }, []);

  const weeklySeries = useMemo(() => {
    return [...weekly]
      .reverse()
      .map((row) => ({
        week: row.week_start,
        learning_score: toNum(row.learning_score),
        missed_opportunities: toNum(row.missed_opportunities),
        ranking_accuracy: toNum(row.ranking_accuracy),
        avg_top_rank_return: toNum(row.avg_top_rank_return),
        avg_signal_return: toNum(row.avg_signal_return),
      }));
  }, [weekly]);

  const generationTrend = useMemo(() => {
    return [...daily]
      .reverse()
      .map((row) => ({
        date: row.date,
        generated: toNum(row.signals_generated),
        evaluated: toNum(row.signals_evaluated),
      }));
  }, [daily]);

  const missedByWeek = useMemo(() => {
    return weeklySeries.map((row) => ({ week: row.week, missed: row.missed_opportunities }));
  }, [weeklySeries]);

  return (
    <div style={{ padding: 20, display: 'grid', gap: 16 }}>
      <h2>Calibration Dashboard</h2>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>System Learning Score</h3>
        <div>Daily: {toNum(learning?.daily?.learning_score).toFixed(4)}</div>
        <div>Weekly: {toNum(learning?.weekly?.learning_score).toFixed(4)}</div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Weekly Learning Score</h3>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={weeklySeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="learning_score" stroke="#0b84f3" strokeWidth={2} />
              <Line type="monotone" dataKey="ranking_accuracy" stroke="#26a69a" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Missed Opportunities (Weekly)</h3>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={missedByWeek}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="missed" fill="#ef5350" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Top Ranked vs Average Signal Returns</h3>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={weeklySeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="avg_top_rank_return" stroke="#7e57c2" strokeWidth={2} />
              <Line type="monotone" dataKey="avg_signal_return" stroke="#ff7043" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Signal Generation Trend</h3>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={generationTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="generated" fill="#42a5f5" />
              <Bar dataKey="evaluated" fill="#66bb6a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Strategy Weights</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Strategy</th>
                <th align="right">Weight</th>
                <th align="right">Signals</th>
                <th align="right">Win Rate</th>
                <th align="right">Avg Return</th>
              </tr>
            </thead>
            <tbody>
              {weights.map((w) => (
                <tr key={w.strategy}>
                  <td>{w.strategy}</td>
                  <td align="right">{toNum(w.weight).toFixed(3)}</td>
                  <td align="right">{toNum(w.signals_used)}</td>
                  <td align="right">{(toNum(w.win_rate) * 100).toFixed(2)}%</td>
                  <td align="right">{toNum(w.avg_return).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Recent Missed Opportunities</h3>
        <div>Total tracked: {missed.length}</div>
      </div>
    </div>
  );
}
