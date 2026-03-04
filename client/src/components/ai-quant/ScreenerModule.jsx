import { useState, useEffect, useMemo } from 'react';
import { Star } from 'lucide-react';
import { authFetch } from '../../utils/api';
import ExportButtons from '../shared/ExportButtons';

function fmtVol(v) {
  if (v == null) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
}

function fmtMktCap(v) {
  if (v == null) return '—';
  if (v >= 1e12) return (v / 1e12).toFixed(1) + 'T';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(0) + 'M';
  return String(v);
}

const PAGE_SIZE = 100;

export default function ScreenerModule({
  onSelectTicker, filters, selected, onToggleSelect,
  onDataReady, watchlist, strategyFilter,
}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('rvol');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    authFetch('/api/v3/screener/technical?limit=5000')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(payload => {
        if (cancelled) return;
        const rows = Array.isArray(payload?.data) ? payload.data
          : Array.isArray(payload) ? payload : [];

        const normalized = rows.map(r => ({
          ticker: String(r.symbol || '').toUpperCase(),
          name: r.name || null,
          sector: r.sector || null,
          exchange: r.exchange || null,
          price: r.price ?? null,
          changePercent: r.changePercent ?? r.changesPercentage ?? null,
          gapPercent: r.gapPercent ?? null,
          rvol: r.rvol ?? r.relativeVolume ?? null,
          volume: r.volume ?? null,
          avgVolume: r.avgVolume ?? null,
          marketCap: r.marketCap ?? null,
          rsi14: r.rsi14 ?? null,
          sma20: r.sma20 ?? null,
          sma50: r.sma50 ?? null,
          atr: r.atr ?? null,
        })).filter(r => r.ticker);

        setData(normalized);
        onDataReady?.('screener', normalized);
        setError(null);
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [onDataReady]);

  // Apply strategy chip filter
  const strategyFiltered = useMemo(
    () => strategyFilter ? data.filter(strategyFilter) : data,
    [data, strategyFilter]
  );

  // Apply global filters (price, rvol, volume)
  const filtered = useMemo(() => {
    if (!filters) return strategyFiltered;
    return strategyFiltered.filter(r => {
      if (filters.priceMin && (r.price == null || r.price < Number(filters.priceMin))) return false;
      if (filters.priceMax && (r.price == null || r.price > Number(filters.priceMax))) return false;
      if (filters.rvolMin && (r.rvol == null || r.rvol < Number(filters.rvolMin))) return false;
      if (filters.avgVolMin && (r.avgVolume == null || r.avgVolume < Number(filters.avgVolMin))) return false;
      return true;
    });
  }, [strategyFiltered, filters]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortAsc ? av - bv : bv - av;
    });
    return arr;
  }, [filtered, sortKey, sortAsc]);

  const visible = useMemo(() => sorted.slice(0, page * PAGE_SIZE), [sorted, page]);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
    setPage(1);
  };

  const SortHeader = ({ k, label }) => (
    <th onClick={() => handleSort(k)} className="aiq-th aiq-th--sortable">
      {label} {sortKey === k ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  );

  if (loading) return <div className="aiq-module-loading">Loading full market universe…</div>;
  if (error) return (
    <div className="aiq-module-error">
      <div>Could not load screener data.</div>
      <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>{error}</div>
    </div>
  );
  if (!data.length) return (
    <div className="aiq-module-empty">
      <div>No data in screener universe.</div>
      <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>
        Data requires FMP_API_KEY and a populated daily_ohlc database table.
      </div>
    </div>
  );

  return (
    <div className="aiq-module">
      <div className="aiq-module__bar">
        <span className="aiq-module__universe">
          📊 Universe: Full Market · {data.length.toLocaleString()} stocks
        </span>
        <span className="aiq-module__count">
          {filtered.length.toLocaleString()} / {data.length.toLocaleString()}
        </span>
      </div>

      <ExportButtons
        data={sorted}
        columns={[
          { key: 'ticker', label: 'Ticker' },
          { key: 'sector', label: 'Sector' },
          { key: 'price', label: 'Price', accessor: r => r.price?.toFixed(2) || '' },
          { key: 'changePercent', label: 'Change%', accessor: r => r.changePercent != null ? `${r.changePercent.toFixed(2)}%` : '' },
          { key: 'gapPercent', label: 'Gap%', accessor: r => r.gapPercent != null ? `${r.gapPercent.toFixed(2)}%` : '' },
          { key: 'rvol', label: 'RVOL', accessor: r => r.rvol?.toFixed(2) || '' },
          { key: 'volume', label: 'Volume', accessor: r => r.volume?.toLocaleString() || '' },
          { key: 'marketCap', label: 'Mkt Cap', accessor: r => fmtMktCap(r.marketCap) },
          { key: 'rsi14', label: 'RSI14', accessor: r => r.rsi14?.toFixed(1) || '' },
        ]}
        filename="intelligence-screener"
      />

      <div className="aiq-table-wrap overflow-x-auto">
        <table className="aiq-table min-w-[900px] w-full">
          <thead>
            <tr>
              <th className="aiq-th" style={{ width: 40 }}></th>
              <th className="aiq-th">Ticker</th>
              <th className="aiq-th">Sector</th>
              <SortHeader k="price" label="Price" />
              <SortHeader k="changePercent" label="Change%" />
              <SortHeader k="gapPercent" label="Gap%" />
              <SortHeader k="rvol" label="RVOL" />
              <SortHeader k="volume" label="Volume" />
              <SortHeader k="marketCap" label="Mkt Cap" />
              <SortHeader k="rsi14" label="RSI14" />
            </tr>
          </thead>
          <tbody>
            {visible.map(row => (
              <tr
                key={row.ticker}
                className={`aiq-row ${selected?.has(row.ticker) ? 'aiq-row--selected' : ''}`}
                onClick={() => onSelectTicker?.(row.ticker)}
              >
                <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                  <button
                    className={`btn-icon${watchlist?.has(row.ticker) ? ' active' : ''}`}
                    title={watchlist?.has(row.ticker) ? 'Remove from watchlist' : 'Add to watchlist'}
                    onClick={() => watchlist?.has(row.ticker)
                      ? watchlist.remove(row.ticker)
                      : watchlist?.add(row.ticker, 'ai-quant')}
                  >
                    <Star size={16} />
                  </button>
                </td>
                <td className="aiq-td--ticker">{row.ticker}</td>
                <td style={{ fontSize: 11, opacity: 0.7 }}>{row.sector || '—'}</td>
                <td>{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</td>
                <td className={row.changePercent != null ? (row.changePercent > 0 ? 'positive' : row.changePercent < 0 ? 'negative' : '') : ''}>
                  {row.changePercent != null
                    ? `${row.changePercent > 0 ? '+' : ''}${row.changePercent.toFixed(2)}%`
                    : '—'}
                </td>
                <td className={row.gapPercent != null ? (row.gapPercent > 0 ? 'positive' : row.gapPercent < 0 ? 'negative' : '') : ''}>
                  {row.gapPercent != null
                    ? `${row.gapPercent > 0 ? '+' : ''}${row.gapPercent.toFixed(2)}%`
                    : '—'}
                </td>
                <td style={{ color: row.rvol != null && row.rvol > 2 ? 'var(--accent-orange)' : undefined }}>
                  {row.rvol != null ? `${row.rvol.toFixed(2)}x` : '—'}
                </td>
                <td>{fmtVol(row.volume)}</td>
                <td>{fmtMktCap(row.marketCap)}</td>
                <td style={{
                  color: row.rsi14 != null
                    ? (row.rsi14 > 70 ? 'var(--accent-red)' : row.rsi14 < 30 ? 'var(--accent-green)' : undefined)
                    : undefined,
                }}>
                  {row.rsi14 != null ? row.rsi14.toFixed(1) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length < sorted.length && (
        <div className="flex justify-center py-4">
          <button
            className="rounded-lg border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            onClick={() => setPage(p => p + 1)}
          >
            Show more ({(sorted.length - visible.length).toLocaleString()} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
