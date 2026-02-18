import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCcw, SlidersHorizontal, Star } from 'lucide-react';
import useWatchlist from '../hooks/useWatchlist';
import ExportButtons from '../components/shared/ExportButtons';
import { formatCurrency, formatVolume, formatMarketCap } from '../utils/formatters';

function toNumber(val) {
  const n = Number(String(val ?? '').replace(/[,%]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

export default function ScannerSection({ title, icon, description, filters: presetFilters, sortParam, delay = 0 }) {
  const { add, remove, has } = useWatchlist();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [localFilters, setLocalFilters] = useState({ priceMin: '', priceMax: '', changeMin: '', volumeMin: '' });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ v: '111', f: presetFilters, o: sortParam, l: '50' });
      const res = await fetch(`/api/finviz/screener?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [presetFilters, sortParam]);

  useEffect(() => {
    const timer = setTimeout(fetchData, delay);
    return () => clearTimeout(timer);
  }, [fetchData, delay]);

  const filtered = useMemo(() => {
    return rows.filter(row => {
      const price = toNumber(row.Price);
      const change = toNumber(row.Change);
      const volume = toNumber(row.Volume);
      if (localFilters.priceMin && price < Number(localFilters.priceMin)) return false;
      if (localFilters.priceMax && price > Number(localFilters.priceMax)) return false;
      if (localFilters.changeMin && Math.abs(change) < Number(localFilters.changeMin)) return false;
      if (localFilters.volumeMin && volume < Number(localFilters.volumeMin)) return false;
      return true;
    });
  }, [rows, localFilters]);

  const display = filtered.slice(0, 10);

  return (
    <div className="scanner-section panel">
      <div className="scanner-section__header">
        <div className="scanner-section__title">
          <span className="scanner-section__icon">{icon}</span>
          <div>
            <h3 style={{ margin: 0 }}>{title}</h3>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>{description}</p>
          </div>
        </div>
        <div className="scanner-section__actions">
          <span className="muted" style={{ fontSize: 12 }}>{filtered.length} results</span>
          <button className="btn-icon" onClick={() => setShowFilters(s => !s)} title="Filters">
            <SlidersHorizontal size={14} />
          </button>
          <button className="btn-icon" onClick={fetchData} title="Refresh" disabled={loading}>
            <RefreshCcw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="scanner-section__filters">
          <input className="input-field input-sm" placeholder="Price min" value={localFilters.priceMin}
            onChange={e => setLocalFilters(f => ({ ...f, priceMin: e.target.value }))} />
          <input className="input-field input-sm" placeholder="Price max" value={localFilters.priceMax}
            onChange={e => setLocalFilters(f => ({ ...f, priceMax: e.target.value }))} />
          <input className="input-field input-sm" placeholder="Change % min" value={localFilters.changeMin}
            onChange={e => setLocalFilters(f => ({ ...f, changeMin: e.target.value }))} />
          <input className="input-field input-sm" placeholder="Volume min" value={localFilters.volumeMin}
            onChange={e => setLocalFilters(f => ({ ...f, volumeMin: e.target.value }))} />
        </div>
      )}

      {error && <div style={{ color: 'var(--accent-red)', padding: '8px 0', fontSize: 13 }}>Failed: {error}</div>}

      <ExportButtons
        data={filtered}
        columns={[
          { key: 'Ticker', label: 'Ticker' },
          { key: 'Company', label: 'Company' },
          { key: 'Price', label: 'Price' },
          { key: 'Change', label: 'Change' },
          { key: 'Volume', label: 'Volume' },
          { key: 'Market Cap', label: 'Market Cap' },
        ]}
        filename={`screener-${title.toLowerCase().replace(/\s+/g, '-')}`}
      />

      <div className="scanner-section__table">
        <table className="data-table data-table--compact">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Ticker</th>
              <th>Company</th>
              <th style={{ textAlign: 'right' }}>Price</th>
              <th style={{ textAlign: 'right' }}>Change</th>
              <th style={{ textAlign: 'right' }}>Volume</th>
              <th style={{ textAlign: 'right' }}>Mkt Cap</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>Loading…</td></tr>
            )}
            {!loading && display.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>No results</td></tr>
            )}
            {display.map(row => {
              const inList = has(row.Ticker);
              const changeVal = toNumber(row.Change);
              return (
                <tr key={row.Ticker}>
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn-icon" title={inList ? 'Remove' : 'Add to watchlist'}
                      onClick={() => inList ? remove(row.Ticker) : add(row.Ticker, 'screener')}>
                      <Star size={14} fill={inList ? 'var(--accent-orange)' : 'none'} color={inList ? 'var(--accent-orange)' : 'var(--text-muted)'} />
                    </button>
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{row.Ticker}</td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.Company || '--'}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(toNumber(row.Price))}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }} className={changeVal >= 0 ? 'text-positive' : 'text-negative'}>{row.Change || '--'}</td>
                  <td style={{ textAlign: 'right' }}>{formatVolume(toNumber(row.Volume))}</td>
                  <td style={{ textAlign: 'right' }}>{formatMarketCap(toNumber(row['Market Cap']))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
