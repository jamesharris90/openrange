import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';
import TickerLink from '../components/shared/TickerLink';
import Table from '../components/ui/Table';

function toQuery(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== '' && value != null) params.set(key, String(value));
  });
  return params.toString();
}

export default function ScreenerFull() {
  const [filters, setFilters] = useState({
    price_min: '',
    price_max: '',
    rvol_min: '',
    gap_min: '',
    sector: '',
    market_cap: '',
    strategy: '',
  });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('relative_volume');
  const [sortDir, setSortDir] = useState('desc');

  const presets = {
    'Gap & Go': { gap_min: '5', rvol_min: '2', price_min: '1', strategy: 'Gap & Go' },
    'High RVOL': { rvol_min: '3' },
    Momentum: { price_min: '5', rvol_min: '1.5' },
    'Low Float': { price_max: '20', rvol_min: '2', gap_min: '3' },
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const query = toQuery(filters);
      const payload = await apiJSON(`/api/screener/full${query ? `?${query}` : ''}`);
      setRows(Array.isArray(payload?.rows) ? payload.rows : []);
    } catch (err) {
      setRows([]);
      setError(err?.message || 'Failed to load screener');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const sortedRows = [...rows].sort((a, b) => {
    const av = Number(a?.[sortBy] ?? 0);
    const bv = Number(b?.[sortBy] ?? 0);
    if (sortDir === 'asc') return av - bv;
    return bv - av;
  });

  const onSort = (field) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(field);
    setSortDir('desc');
  };

  const applyPreset = (name) => {
    const preset = presets[name] || {};
    setFilters((prev) => ({ ...prev, ...preset }));
  };

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Manual Universe Screener"
          subtitle="Filter the full tradable universe with trader controls."
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Saved Presets</span>
          {Object.keys(presets)?.map((name) => (
            <button key={name} className="rounded border border-[var(--border-color)] px-2 py-1 text-xs" onClick={() => applyPreset(name)}>{name}</button>
          ))}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <input className="input-field" placeholder="Price Min" value={filters.price_min} onChange={(e) => setFilter('price_min', e.target.value)} />
          <input className="input-field" placeholder="Price Max" value={filters.price_max} onChange={(e) => setFilter('price_max', e.target.value)} />
          <input className="input-field" placeholder="RVol Min" value={filters.rvol_min} onChange={(e) => setFilter('rvol_min', e.target.value)} />
          <input className="input-field" placeholder="Gap Min" value={filters.gap_min} onChange={(e) => setFilter('gap_min', e.target.value)} />
          <input className="input-field" placeholder="Sector" value={filters.sector} onChange={(e) => setFilter('sector', e.target.value)} />
          <input className="input-field" placeholder="Market Cap Min" value={filters.market_cap} onChange={(e) => setFilter('market_cap', e.target.value)} />
          <input className="input-field" placeholder="Strategy" value={filters.strategy} onChange={(e) => setFilter('strategy', e.target.value)} />
          <button className="btn-primary" onClick={load}>Apply Filters</button>
        </div>
      </Card>

      <Card>
        {loading ? (
          <LoadingSpinner message="Loading full screener…" />
        ) : error ? (
          <div className="muted">{error}</div>
        ) : rows.length === 0 ? (
          <div className="muted">No symbols match current filters.</div>
        ) : (
          <Table>
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Symbol</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>Change %</th>
                <th style={{ textAlign: 'right' }}>Gap %</th>
                <th style={{ textAlign: 'right' }}>RVol</th>
                <th>Sector</th>
                <th>Strategy</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows?.map((row) => (
                <tr key={row?.symbol}>
                  <td><TickerLink symbol={row?.symbol} /></td>
                  <td style={{ textAlign: 'right' }}>{Number(row?.price || 0).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(row?.change_percent || 0).toFixed(2)}%</td>
                  <td style={{ textAlign: 'right' }}>{Number(row?.gap_percent || 0).toFixed(2)}%</td>
                  <td style={{ textAlign: 'right' }}>{Number(row?.relative_volume || 0).toFixed(2)}</td>
                  <td>{row?.sector || '--'}</td>
                  <td>{row?.strategy || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </Table>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-[var(--text-muted)]">Sort:</span>
          <button className="rounded border border-[var(--border-color)] px-2 py-1" onClick={() => onSort('relative_volume')}>RVol</button>
          <button className="rounded border border-[var(--border-color)] px-2 py-1" onClick={() => onSort('gap_percent')}>Gap</button>
          <button className="rounded border border-[var(--border-color)] px-2 py-1" onClick={() => onSort('change_percent')}>Change</button>
          <span className="text-[var(--text-secondary)]">{sortBy} ({sortDir})</span>
        </div>
      </Card>
    </PageContainer>
  );
}
