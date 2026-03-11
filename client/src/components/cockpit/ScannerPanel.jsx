import { useEffect, useMemo, useState } from 'react';
import Card from '../ui/Card';
import { apiJSON } from '../../config/api';
import { useSymbol } from '../../context/SymbolContext';
import ErrorState from '../shared/ErrorState';

const DEFAULT_SORT = { key: 'score', dir: 'desc' };

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(value, digits = 2) {
  const num = toNumber(value);
  if (num == null) return '--';
  return num.toFixed(digits);
}

function normalizeRow(row) {
  return {
    symbol: String(row?.symbol || '').toUpperCase(),
    gap: toNumber(row?.gap ?? row?.gap_percent),
    rvol: toNumber(row?.rvol ?? row?.relative_volume),
    float: toNumber(row?.float ?? row?.float_shares),
    catalyst: row?.catalyst || row?.headline || '--',
    strategy: row?.strategy || row?.setup_type || '--',
    score: toNumber(row?.score),
  };
}

export default function ScannerPanel() {
  const { selectedSymbol, setSelectedSymbol } = useSymbol();
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const payload = await apiJSON('/api/signals?limit=120');
        const list = Array.isArray(payload?.signals) ? payload.signals : Array.isArray(payload) ? payload : [];
        if (!cancelled) {
          setRows(list?.map(normalizeRow).filter((row) => row.symbol));
          setError('');
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setError('Scanner feed unavailable.');
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
    const q = String(query || '').trim().toUpperCase();
    const input = q
      ? rows.filter((row) => row.symbol.includes(q) || String(row.catalyst || '').toUpperCase().includes(q) || String(row.strategy || '').toUpperCase().includes(q))
      : rows;

    const next = [...input].sort((a, b) => {
      const av = a?.[sort.key];
      const bv = b?.[sort.key];
      const direction = sort.dir === 'asc' ? 1 : -1;
      if (typeof av === 'number' && typeof bv === 'number') return direction * (av - bv);
      return direction * String(av || '').localeCompare(String(bv || ''));
    });

    return next;
  }, [rows, query, sort]);

  const updateSort = (key) => {
    setSort((current) => {
      if (current.key === key) {
        return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: 'desc' };
    });
  };

  return (
    <Card className="h-full p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">Scanner</h3>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 w-32 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-xs"
          placeholder="Search ticker"
        />
      </div>

      {error ? <ErrorState title="Scanner unavailable" message={error} /> : null}

      <div className="max-h-[360px] overflow-auto rounded-xl border border-[var(--border-color)]">
        <table className="data-table data-table--compact min-w-[760px]">
          <thead>
            <tr>
              <th onClick={() => updateSort('symbol')}>Ticker</th>
              <th onClick={() => updateSort('gap')} style={{ textAlign: 'right' }}>Gap %</th>
              <th onClick={() => updateSort('rvol')} style={{ textAlign: 'right' }}>RVOL</th>
              <th onClick={() => updateSort('float')} style={{ textAlign: 'right' }}>Float</th>
              <th>Catalyst</th>
              <th>Strategy</th>
              <th onClick={() => updateSort('score')} style={{ textAlign: 'right' }}>Score</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 60)?.map((row) => (
              <tr
                key={`${row.symbol}-${row.score ?? ''}`}
                onClick={() => setSelectedSymbol(row.symbol)}
                className={selectedSymbol === row.symbol ? 'bg-[rgba(74,158,255,0.16)]' : ''}
                style={{ cursor: 'pointer' }}
              >
                <td className="font-semibold">{row.symbol}</td>
                <td style={{ textAlign: 'right' }}>{fmt(row.gap, 2)}%</td>
                <td style={{ textAlign: 'right' }}>{fmt(row.rvol, 2)}</td>
                <td style={{ textAlign: 'right' }}>{row.float == null ? '--' : Number(row.float).toLocaleString()}</td>
                <td>{row.catalyst}</td>
                <td>{row.strategy}</td>
                <td style={{ textAlign: 'right' }}>{fmt(row.score, 1)}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className="text-center text-xs text-[var(--text-muted)]">No scanner rows available.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
