import { useEffect, useMemo, useState } from 'react';
import Card from '../ui/Card';
import { apiJSON } from '../../config/api';
import { useSymbol } from '../../context/SymbolContext';
import ErrorState from '../shared/ErrorState';

function toNumber(value, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '--';
  return parsed.toFixed(digits);
}

export default function SignalsPanel() {
  const { selectedSymbol } = useSymbol();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/signals?limit=120');
        const list = Array.isArray(payload?.signals) ? payload.signals : Array.isArray(payload) ? payload : [];
        if (!cancelled) {
          setRows(list);
          setError('');
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setError('Signal feed unavailable.');
        }
      }
    }

    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const filtered = useMemo(() => {
    const symbol = String(selectedSymbol || '').toUpperCase();
    return rows
      .filter((row) => String(row?.symbol || '').toUpperCase() === symbol)
      .slice(0, 10);
  }, [rows, selectedSymbol]);

  return (
    <Card className="h-full p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">Signals</h3>
        <span className="text-xs text-[var(--text-muted)]">{selectedSymbol}</span>
      </div>

      {error ? <ErrorState title="Signals unavailable" message={error} /> : null}

      <div className="overflow-auto rounded-xl border border-[var(--border-color)]">
        <table className="data-table data-table--compact min-w-[460px]">
          <thead>
            <tr>
              <th>Setup</th>
              <th style={{ textAlign: 'right' }}>Score</th>
              <th style={{ textAlign: 'right' }}>RVOL</th>
              <th style={{ textAlign: 'right' }}>Gap %</th>
              <th>Catalyst</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, index) => (
              <tr key={`${row?.symbol || selectedSymbol}-${row?.setup_type || row?.strategy || index}`}>
                <td>{row?.setup_type || row?.strategy || '--'}</td>
                <td style={{ textAlign: 'right' }}>{toNumber(row?.strategy_score ?? row?.score, 1)}</td>
                <td style={{ textAlign: 'right' }}>{toNumber(row?.relative_volume ?? row?.rvol, 2)}</td>
                <td style={{ textAlign: 'right' }}>{toNumber(row?.gap_percent ?? row?.gap, 2)}%</td>
                <td>{row?.catalyst || '--'}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={5} className="text-center text-xs text-[var(--text-muted)]">No active signals for this symbol.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
