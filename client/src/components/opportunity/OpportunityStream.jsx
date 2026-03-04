import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../../config/api';
import LoadingSpinner from '../shared/LoadingSpinner';
import TradingViewChart from '../shared/TradingViewChart';

const REFRESH_MS = 15000;

function fmtScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(1);
}

function fmtTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString();
}

export default function OpportunityStream({ limit = 50, compact = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!cancelled) setLoading((prev) => prev && rows.length === 0);
      try {
        const payload = await apiJSON('/api/opportunity-stream');
        if (cancelled) return;
        const list = Array.isArray(payload) ? payload : [];
        setRows(limit > 0 ? list.slice(0, limit) : list);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [limit]);

  const data = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);

  return (
    <div className="space-y-3">
      {loading && data.length === 0 ? (
        <LoadingSpinner message="Loading opportunity stream…" />
      ) : data.length === 0 ? (
        <div className="muted">No active opportunities detected</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table data-table--compact min-w-[740px]">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Event</th>
                <th>Headline</th>
                <th style={{ textAlign: 'right' }}>Score</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const symbol = String(row?.symbol || '').toUpperCase();
                return (
                  <tr
                    key={row?.id || `${symbol}-${row?.event_type}-${row?.created_at}`}
                    onClick={() => symbol && setSelectedSymbol(symbol)}
                    style={{ cursor: symbol ? 'pointer' : 'default' }}
                  >
                    <td>{symbol || '--'}</td>
                    <td>{row?.event_type || '--'}</td>
                    <td>{row?.headline || '--'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtScore(row?.score)}</td>
                    <td>{fmtTime(row?.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!compact && selectedSymbol && (
        <div>
          <div className="muted" style={{ marginBottom: 6 }}>Chart: {selectedSymbol}</div>
          <TradingViewChart symbol={selectedSymbol} height={280} interval="15" range="5D" hideSideToolbar />
        </div>
      )}
    </div>
  );
}
