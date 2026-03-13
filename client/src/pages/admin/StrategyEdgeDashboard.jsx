import React, { useEffect, useState } from 'react';
import { apiClient } from '../../api/apiClient';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function StrategyEdgeDashboard() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    apiClient('/admin/learning/strategies')
      .then((data) => setItems(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setItems([]));
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>Strategy Edge Dashboard</h1>
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Strategy</th>
              <th align="right">Signals</th>
              <th align="right">Win Rate</th>
              <th align="right">Avg Return</th>
              <th align="right">Expected Move Hit</th>
              <th align="right">False Signal Rate</th>
              <th align="right">Edge Score</th>
              <th align="right">Learning Score</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.strategy}>
                <td>{item.strategy}</td>
                <td align="right">{toNum(item.signals_count)}</td>
                <td align="right">{(toNum(item.win_rate) * 100).toFixed(2)}%</td>
                <td align="right">{toNum(item.avg_return).toFixed(2)}%</td>
                <td align="right">{(toNum(item.expected_move_hit_rate) * 100).toFixed(2)}%</td>
                <td align="right">{(toNum(item.false_signal_rate) * 100).toFixed(2)}%</td>
                <td align="right">{toNum(item.edge_score).toFixed(4)}</td>
                <td align="right">{toNum(item.learning_score).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
