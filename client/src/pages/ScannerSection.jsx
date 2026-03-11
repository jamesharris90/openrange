import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCcw, SlidersHorizontal, Star } from 'lucide-react';
import useWatchlist from '../hooks/useWatchlist';
import { apiJSON } from '../config/api';
import ExportButtons from '../components/shared/ExportButtons';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { formatCurrency, formatVolume, formatMarketCap } from '../utils/formatters';

function toNumber(val) {
  const n = Number(String(val ?? '').replace(/[,%]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function pickField(row, fields, fallback = null) {
  for (const key of fields) {
    if (row?.[key] != null && row?.[key] !== '') return row[key];
  }
  return fallback;
}

export default function ScannerSection({ title, icon, description, queryPreset = {}, delay = 0 }) {
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
      const data = await apiJSON('/api/scanner');
      const rawRows = Array.isArray(data?.data) ? data?.data : (Array.isArray(data) ? data : []);
      const nextRows = rawRows?.map((row) => ({
        symbol: row?.symbol,
        ticker: row?.symbol,
        Ticker: row?.symbol,
        name: row?.company_name || row?.name || row?.companyName || '',
        companyName: row?.company_name || row?.name || row?.companyName || '',
        Company: row?.company_name || row?.name || row?.companyName || '',
        price: row?.price,
        Price: row?.price,
        changePercent: row?.gap_percent,
        Change: row?.gap_percent,
        volume: row?.relative_volume,
        Volume: row?.relative_volume,
        marketCap: row?.setup_score,
        'Market Cap': row?.setup_score,
      }));
      setRows(nextRows);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [queryPreset]);

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
          { key: 'symbol', label: 'Ticker' },
          { key: 'name', label: 'Company' },
          { key: 'price', label: 'Price' },
          { key: 'changePercent', label: 'Change' },
          { key: 'volume', label: 'Volume' },
          { key: 'marketCap', label: 'Market Cap' },
        ]}
        filename={`screener-${title.toLowerCase().replace(/\s+/g, '-')}`}
      />

      <div className="scanner-section__table overflow-x-auto">
        {loading && !rows.length && <LoadingSpinner message="Loading scanner data…" />}
        <table className="data-table data-table--compact min-w-[900px]">
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
            {display?.map(row => {
              const ticker = String(pickField(row, ['symbol', 'ticker', 'Ticker'], '')).toUpperCase();
              const company = pickField(row, ['name', 'companyName', 'Company'], '--');
              const price = toNumber(pickField(row, ['price', 'Price']));
              const changeVal = toNumber(pickField(row, ['changePercent', 'Change']));
              const volume = toNumber(pickField(row, ['volume', 'Volume']));
              const marketCap = toNumber(pickField(row, ['marketCap', 'Market Cap']));
              const inList = has(ticker);
              return (
                <tr key={ticker}>
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn-icon" title={inList ? 'Remove' : 'Add to watchlist'}
                      onClick={() => inList ? remove(ticker) : add(ticker, 'screener')}>
                      <Star size={14} fill={inList ? 'var(--accent-orange)' : 'none'} color={inList ? 'var(--accent-orange)' : 'var(--text-muted)'} />
                    </button>
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{ticker || '--'}</td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{company}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(price)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }} className={changeVal >= 0 ? 'text-positive' : 'text-negative'}>{Number.isFinite(changeVal) ? `${changeVal.toFixed(2)}%` : '--'}</td>
                  <td style={{ textAlign: 'right' }}>{formatVolume(volume)}</td>
                  <td style={{ textAlign: 'right' }}>{formatMarketCap(marketCap)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
