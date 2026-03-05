import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { apiJSON } from '../config/api';

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

  return (
    <PageContainer className="space-y-3">
      <Card>
        <PageHeader
          title="Manual Universe Screener"
          subtitle="Filter the full tradable universe with trader controls."
        />
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
              {rows.map((row) => (
                <tr key={row?.symbol}>
                  <td>{String(row?.symbol || '').toUpperCase()}</td>
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
        )}
      </Card>
    </PageContainer>
  );
}
