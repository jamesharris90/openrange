import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Download, SlidersHorizontal, FilterX, Star, AlertCircle } from 'lucide-react';
import useWatchlist from '../hooks/useWatchlist';
import { formatNumber } from '../utils/formatters';

const VIEWS = [
  { id: 'overview', label: 'Overview', viewParam: '111', columns: ['Ticker', 'Company', 'Sector', 'Industry', 'Market Cap', 'Price', 'Change', 'Volume'] },
  { id: 'valuation', label: 'Valuation', viewParam: '121', columns: ['Ticker', 'Market Cap', 'P/E', 'Forward P/E', 'PEG', 'P/S', 'P/B', 'P/C', 'P/FCF'] },
  { id: 'financial', label: 'Financial', viewParam: '161', columns: ['Ticker', 'Market Cap', 'Dividend %', 'ROA', 'ROE', 'ROI', 'Current Ratio', 'Quick Ratio', 'LT Debt/Eq', 'Debt/Eq'] },
  { id: 'ownership', label: 'Ownership', viewParam: '131', columns: ['Ticker', 'Market Cap', 'Outstanding', 'Float', 'Insider Own', 'Insider Trans', 'Inst Own', 'Inst Trans', 'Short Float', 'Short Ratio'] },
  { id: 'performance', label: 'Performance', viewParam: '141', columns: ['Ticker', 'Perf Week', 'Perf Month', 'Perf Quart', 'Perf Half', 'Perf Year', 'Perf YTD', 'Volatility W', 'Volatility M', 'Avg Volume'] },
  { id: 'technical', label: 'Technical', viewParam: '171', columns: ['Ticker', 'Beta', 'ATR', 'SMA20', 'SMA50', 'SMA200', '52W High', '52W Low', 'RSI', 'Price', 'Change', 'Volume'] },
];

const DEFAULT_FILTERS = {
  tickersInput: '',
  searchText: '',
  priceMin: '',
  priceMax: '',
  changeMin: '',
  volumeMin: '500000',
  relVolMin: '1',
  marketCapMin: '',
  marketCapMax: '',
};

function parseTickers(str) {
  return (str || '')
    .split(/[,\s]+/)
    .map(t => t.trim().toUpperCase())
    .filter(Boolean);
}

function toNumber(value) {
  if (value == null) return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function getRelVol(row) {
  const val = row['Relative Volume'] || row['Rel Volume'];
  return toNumber(val);
}

function getPrice(row) {
  return toNumber(row.Price);
}

function getChange(row) {
  const n = Number(String(row.Change || '').replace('%', ''));
  return Number.isNaN(n) ? 0 : n;
}

function getVolume(row) {
  return toNumber(row.Volume);
}

function getMarketCap(row) {
  return toNumber(row['Market Cap']);
}

function sortRows(rows, sort) {
  if (!sort.column) return rows;
  const dir = sort.direction === 'asc' ? 1 : -1;
  const data = [...rows];
  data.sort((a, b) => {
    const aVal = a[sort.column] ?? '';
    const bVal = b[sort.column] ?? '';
    if (typeof aVal === 'string' || typeof bVal === 'string') {
      return dir * aVal.toString().localeCompare(bVal.toString());
    }
    return dir * ((aVal || 0) - (bVal || 0));
  });
  return data;
}

function exportCSV(rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')].concat(rows.map(r => headers.map(h => {
    const val = r[h];
    if (val == null) return '';
    const str = String(val).replace(/"/g, '""');
    return str.includes(',') ? `"${str}"` : str;
  }).join(','))).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `advanced-screener-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdvancedScreenerPage() {
  const { add: addToWatchlist, remove: removeFromWatchlist, has: hasWatchlist } = useWatchlist();
  const [activeView, setActiveView] = useState(VIEWS[0]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ column: 'Change', direction: 'desc' });

  const tickerList = useMemo(() => parseTickers(filters.tickersInput), [filters.tickersInput]);

  const filteredRows = useMemo(() => {
    return rows.filter(row => {
      if (tickerList.length && !tickerList.includes(row.Ticker)) return false;

      const price = getPrice(row);
      const change = getChange(row);
      const volume = getVolume(row);
      const relVol = getRelVol(row);
      const marketCap = getMarketCap(row);

      if (filters.priceMin && price < Number(filters.priceMin)) return false;
      if (filters.priceMax && price > Number(filters.priceMax)) return false;
      if (filters.changeMin && change < Number(filters.changeMin)) return false;
      if (filters.volumeMin && volume < Number(filters.volumeMin)) return false;
      if (filters.relVolMin && relVol < Number(filters.relVolMin)) return false;
      if (filters.marketCapMin && marketCap < Number(filters.marketCapMin)) return false;
      if (filters.marketCapMax && marketCap > Number(filters.marketCapMax)) return false;

      if (filters.searchText) {
        const q = filters.searchText.toLowerCase();
        const text = `${row.Ticker || ''} ${row.Company || ''} ${row.Sector || ''} ${row.Industry || ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    });
  }, [rows, filters, tickerList]);

  const sortedRows = useMemo(() => sortRows(filteredRows, sort), [filteredRows, sort]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView.id]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ v: activeView.viewParam, l: '200' });
      if (tickerList.length) params.set('t', tickerList.join(','));
      const resp = await fetch(`/api/finviz/screener?${params.toString()}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function setSortColumn(col) {
    setSort(prev => {
      if (prev.column === col) {
        return { column: col, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { column: col, direction: 'desc' };
    });
  }

  function quickPreset(name) {
    switch (name) {
      case 'momentum':
        setFilters(f => ({ ...f, priceMin: '1', priceMax: '30', changeMin: '3', relVolMin: '1.2', volumeMin: '500000' }));
        break;
      case 'value':
        setFilters(f => ({ ...f, priceMin: '', priceMax: '', changeMin: '', relVolMin: '', volumeMin: '1000000', marketCapMin: '2000000000' }));
        break;
      case 'gainers':
        setFilters(f => ({ ...f, priceMin: '2', changeMin: '5', relVolMin: '1.5', volumeMin: '750000' }));
        break;
      default:
        setFilters(DEFAULT_FILTERS);
        break;
    }
  }

  return (
    <div className="page-container">
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-header">
          <div>
            <h2 style={{ margin: 0 }}>Advanced Stock Screener</h2>
            <p className="muted" style={{ marginTop: 4 }}>Finviz Elite views with quick presets, filters, and watchlist actions.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-secondary btn-sm" onClick={() => setFilters(DEFAULT_FILTERS)}><FilterX size={14} /> Clear Filters</button>
            <button className="btn-secondary btn-sm" onClick={fetchData}><RefreshCcw size={14} /> Refresh</button>
            <button className="btn-primary btn-sm" onClick={() => exportCSV(sortedRows)} disabled={!sortedRows.length}><Download size={14} /> Export CSV</button>
          </div>
        </div>

        <div className="tabs" style={{ marginTop: 12 }}>
          {VIEWS.map(view => (
            <button
              key={view.id}
              className={`tab${activeView.id === view.id ? ' active' : ''}`}
              onClick={() => setActiveView(view)}
            >
              {view.label}
            </button>
          ))}
        </div>

        <div className="filters-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 12 }}>
          <input className="input-field" placeholder="Tickers (comma separated)" value={filters.tickersInput} onChange={e => setFilters(f => ({ ...f, tickersInput: e.target.value }))} />
          <input className="input-field" placeholder="Search company/sector" value={filters.searchText} onChange={e => setFilters(f => ({ ...f, searchText: e.target.value }))} />
          <input className="input-field" placeholder="Price min" value={filters.priceMin} onChange={e => setFilters(f => ({ ...f, priceMin: e.target.value }))} />
          <input className="input-field" placeholder="Price max" value={filters.priceMax} onChange={e => setFilters(f => ({ ...f, priceMax: e.target.value }))} />
          <input className="input-field" placeholder="Change % min" value={filters.changeMin} onChange={e => setFilters(f => ({ ...f, changeMin: e.target.value }))} />
          <input className="input-field" placeholder="Volume min" value={filters.volumeMin} onChange={e => setFilters(f => ({ ...f, volumeMin: e.target.value }))} />
          <input className="input-field" placeholder="RelVol min" value={filters.relVolMin} onChange={e => setFilters(f => ({ ...f, relVolMin: e.target.value }))} />
          <input className="input-field" placeholder="Mkt Cap min" value={filters.marketCapMin} onChange={e => setFilters(f => ({ ...f, marketCapMin: e.target.value }))} />
          <input className="input-field" placeholder="Mkt Cap max" value={filters.marketCapMax} onChange={e => setFilters(f => ({ ...f, marketCapMax: e.target.value }))} />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <span className="muted">Quick presets:</span>
          <button className="pill-btn" onClick={() => quickPreset('momentum')}>Small-Cap Momentum</button>
          <button className="pill-btn" onClick={() => quickPreset('gainers')}>Day Gainers</button>
          <button className="pill-btn" onClick={() => quickPreset('value')}>Large/Mid Value</button>
          <button className="pill-btn" onClick={() => quickPreset('reset')}>Reset</button>
          <span className="muted" style={{ marginLeft: 'auto' }}>{sortedRows.length} results</span>
        </div>
      </div>

      {error && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} />
            <span>Could not load screener data: {error}</span>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                {activeView.columns.map(col => (
                  <th key={col} onClick={() => setSortColumn(col)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{col}</span>
                      {sort.column === col && <span className="muted">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
                    </div>
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!loading && sortedRows.length === 0 && (
                <tr>
                  <td colSpan={activeView.columns.length + 1} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    No results. Adjust filters and refresh.
                  </td>
                </tr>
              )}

              {loading && (
                <tr><td colSpan={activeView.columns.length + 1} style={{ padding: 20 }}>Loading screener data…</td></tr>
              )}

              {!loading && sortedRows.map((row) => {
                const inList = hasWatchlist(row.Ticker);
                return (
                  <tr key={`${row.Ticker}-${row.Price}`}>
                    {activeView.columns.map(col => {
                      const value = row[col];
                      const isNumber = typeof value === 'number' || /Volume|Cap|P\/E|PEG|ATR|Beta|RSI|Change|Perf|SMA|High|Low/i.test(col);
                      const display = isNumber ? formatNumber(value) : value;
                      const changeClass = col === 'Change' ? (getChange(row) >= 0 ? 'text-positive' : 'text-negative') : '';
                      const tickerCell = col === 'Ticker';
                      return (
                        <td key={col} className={changeClass}>
                          {tickerCell ? <span style={{ fontWeight: 700 }}>{display}</span> : display || '--'}
                        </td>
                      );
                    })}
                    <td style={{ width: 48 }}>
                      <button
                        className="btn-icon"
                        title={inList ? 'Remove from watchlist' : 'Add to watchlist'}
                        onClick={(e) => { e.stopPropagation(); inList ? removeFromWatchlist(row.Ticker) : addToWatchlist(row.Ticker, 'advanced-screener'); }}
                      >
                        <Star size={16} fill={inList ? 'var(--accent-orange)' : 'none'} color={inList ? 'var(--accent-orange)' : 'var(--text-muted)'} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
