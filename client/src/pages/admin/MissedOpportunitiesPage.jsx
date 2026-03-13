import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { apiClient } from '../../api/apiClient';

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function MissedOpportunitiesPage() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [candles, setCandles] = useState([]);

  useEffect(() => {
    apiClient('/admin/validation/missed').then((data) => {
      const rows = Array.isArray(data?.items) ? data.items : [];
      setItems(rows);
      if (rows[0]) setSelected(rows[0]);
    }).catch(() => {
      setItems([]);
    });
  }, []);

  useEffect(() => {
    if (!selected?.symbol || !selected?.date) return;

    apiClient(`/admin/validation/missed-candles?symbol=${encodeURIComponent(selected.symbol)}&date=${encodeURIComponent(selected.date)}`)
      .then((data) => setCandles(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setCandles([]));
  }, [selected]);

  const chartData = useMemo(() => candles.map((c) => ({
    date: c.date,
    close: toNum(c.close),
    high: toNum(c.high),
    low: toNum(c.low),
  })), [candles]);

  return (
    <div style={{ padding: 20, display: 'grid', gap: 16 }}>
      <h2>Missed Opportunities</h2>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Symbol</th>
              <th align="left">Date</th>
              <th align="right">Move %</th>
              <th align="left">Reason</th>
              <th align="left">Replayed</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const isSelected = selected?.id === row.id;
              return (
                <tr
                  key={row.id}
                  onClick={() => setSelected(row)}
                  style={{ background: isSelected ? '#f0f7ff' : 'transparent', cursor: 'pointer' }}
                >
                  <td>{row.symbol}</td>
                  <td>{row.date}</td>
                  <td align="right">{toNum(row.move_percent).toFixed(2)}</td>
                  <td>{row.reason}</td>
                  <td>{row.replayed ? 'true' : 'false'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Daily OHLC Around Missed Move</h3>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="close" fill="#64b5f6" />
              {selected?.date ? <ReferenceLine x={selected.date} stroke="#ef5350" strokeWidth={2} /> : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
