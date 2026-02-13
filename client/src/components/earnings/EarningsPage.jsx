import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import useEarningsCalendar from '../../hooks/useEarningsCalendar';
import useWatchlist from '../../hooks/useWatchlist';
import WeekSelector from './WeekSelector';
import EarningsFilters from './EarningsFilters';
import EarningsResearchPanel from './EarningsResearchPanel';
import { formatCurrency, formatPercent, formatMarketCap, formatVolume, formatFloat } from '../../utils/formatters';
import { EARNINGS_TIME_LABELS, EARNINGS_TIME_COLORS } from '../../utils/constants';
import { calcTradeScore, getScoreColor, getScoreLabel, DEFAULT_VISIBLE_COLUMNS, ALL_COLUMN_KEYS } from '../../utils/earningsScoring';
import { Star, Download, Loader2, ChevronUp, ChevronDown, Columns3, Minus, Plus, CheckSquare } from 'lucide-react';

const DEFAULT_FILTERS = {
  marketCapMin: '', marketCapMax: '', minPrice: '', maxPrice: '', time: '', search: '',
  minAvgVolume: '', minRvol: '', maxFloat: '', minScore: '',
  _mcapCustom: false, _priceCustom: false,
};

// Static column definitions — render functions receive row + helpers via closure at render time
const COLUMN_SPECS = [
  { key: 'select', label: '', sortable: false, alwaysVisible: true },
  { key: 'score', label: 'Score', align: 'center', sortValue: (row) => calcTradeScore(row) },
  { key: 'symbol', label: 'Symbol', alwaysVisible: true },
  { key: 'companyName', label: 'Company' },
  { key: 'hour', label: 'Time' },
  { key: 'epsEstimate', label: 'EPS Est', align: 'right', sortValue: (row) => row.epsEstimate },
  { key: 'epsActual', label: 'EPS Act', align: 'right', sortValue: (row) => row.epsActual },
  { key: 'surprisePercent', label: 'Surprise%', align: 'right', sortValue: (row) => row.surprisePercent },
  { key: 'revenueEstimate', label: 'Rev Est', align: 'right', sortValue: (row) => row.revenueEstimate },
  { key: 'revenueActual', label: 'Rev Act', align: 'right', sortValue: (row) => row.revenueActual },
  { key: 'marketCap', label: 'Mkt Cap', align: 'right', sortValue: (row) => row.marketCap },
  { key: 'price', label: 'Price', align: 'right', sortValue: (row) => row.price },
  { key: 'changePercent', label: 'Chg%', align: 'right', sortValue: (row) => row.changePercent },
  { key: 'avgVolume', label: 'Avg Vol', align: 'right', sortValue: (row) => row.avgVolume },
  { key: 'volume', label: 'Volume', align: 'right', sortValue: (row) => row.volume },
  { key: 'rvol', label: 'RVOL', align: 'right', sortValue: (row) => row.rvol },
  { key: 'floatShares', label: 'Float', align: 'right', sortValue: (row) => row.floatShares },
  { key: 'sharesShort', label: 'Short', align: 'right', sortValue: (row) => row.sharesShort },
  { key: 'shortPercentOfFloat', label: 'SI%', align: 'right', sortValue: (row) => row.shortPercentOfFloat },
  { key: 'preMarketChangePercent', label: 'PreMkt%', align: 'right', sortValue: (row) => row.preMarketChangePercent },
  { key: 'dist200MA', label: '200MA%', align: 'right', sortValue: (row) => row.dist200MA },
  { key: 'dist52WH', label: '52WH%', align: 'right', sortValue: (row) => row.dist52WH },
  { key: 'analystRating', label: 'Analyst', align: 'center' },
  { key: 'watchlist', label: '', sortable: false, alwaysVisible: true },
];

// Cell renderer by column key
function renderCell(key, row, { has, add, remove }) {
  switch (key) {
    case 'score': {
      const score = calcTradeScore(row);
      const sc = getScoreColor(score);
      return <span className="score-pill" style={{ background: sc.bg, color: sc.color }} title={getScoreLabel(score)}>{score}</span>;
    }
    case 'symbol':
      return <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{row.symbol}</span>;
    case 'hour': {
      const t = row.hour;
      const colors = EARNINGS_TIME_COLORS[t] || {};
      return <span className="time-badge" style={{ background: colors.bg, color: colors.color }}>{EARNINGS_TIME_LABELS[t] || t || '--'}</span>;
    }
    case 'epsEstimate':
      return row.epsEstimate != null ? `$${row.epsEstimate.toFixed(2)}` : '--';
    case 'epsActual': {
      if (row.epsActual == null) return '--';
      const beat = row.epsEstimate != null ? row.epsActual >= row.epsEstimate : null;
      return <span style={beat != null ? { color: beat ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 } : undefined}>${row.epsActual.toFixed(2)}</span>;
    }
    case 'surprisePercent': {
      if (row.surprisePercent == null) return '--';
      const positive = row.surprisePercent >= 0;
      return <span style={{ color: positive ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>{positive ? '+' : ''}{row.surprisePercent.toFixed(1)}%</span>;
    }
    case 'revenueEstimate':
      return row.revenueEstimate != null ? formatMarketCap(row.revenueEstimate) : '--';
    case 'revenueActual':
      return row.revenueActual != null ? formatMarketCap(row.revenueActual) : '--';
    case 'marketCap':
      return formatMarketCap(row.marketCap);
    case 'price':
      return formatCurrency(row.price);
    case 'changePercent':
      return <span style={{ color: (row.changePercent || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{formatPercent(row.changePercent)}</span>;
    case 'avgVolume':
      return formatVolume(row.avgVolume);
    case 'volume':
      return formatVolume(row.volume);
    case 'rvol': {
      if (row.rvol == null) return '--';
      const color = row.rvol >= 3 ? 'var(--accent-green)' : row.rvol >= 1.5 ? 'var(--accent-orange)' : 'var(--text-secondary)';
      return <span style={{ color, fontWeight: row.rvol >= 2 ? 600 : 400 }}>{row.rvol.toFixed(1)}x</span>;
    }
    case 'floatShares':
      return formatFloat(row.floatShares);
    case 'sharesShort':
      return formatFloat(row.sharesShort);
    case 'shortPercentOfFloat': {
      if (row.shortPercentOfFloat == null) return '--';
      const color = row.shortPercentOfFloat >= 20 ? 'var(--accent-red)' : row.shortPercentOfFloat >= 10 ? 'var(--accent-orange)' : 'var(--text-secondary)';
      return <span style={{ color }}>{row.shortPercentOfFloat.toFixed(1)}%</span>;
    }
    case 'preMarketChangePercent': {
      if (row.preMarketChangePercent == null) return '--';
      return <span style={{ color: row.preMarketChangePercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>{formatPercent(row.preMarketChangePercent)}</span>;
    }
    case 'dist200MA': {
      if (row.dist200MA == null) return '--';
      return <span style={{ color: row.dist200MA >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{formatPercent(row.dist200MA)}</span>;
    }
    case 'dist52WH': {
      if (row.dist52WH == null) return '--';
      const near = row.dist52WH > -5;
      return <span style={{ color: near ? 'var(--accent-green)' : 'var(--text-secondary)' }}>{formatPercent(row.dist52WH)}</span>;
    }
    case 'analystRating':
      return row.analystRating || '--';
    case 'watchlist': {
      const inList = has(row.symbol);
      return (
        <button className="btn-icon" title={inList ? 'Remove from watchlist' : 'Add to watchlist'}
          onClick={(e) => { e.stopPropagation(); inList ? remove(row.symbol) : add(row.symbol, 'earnings'); }}>
          <Star size={16} fill={inList ? 'var(--accent-orange)' : 'none'} color={inList ? 'var(--accent-orange)' : 'var(--text-muted)'} />
        </button>
      );
    }
    default:
      return row[key] ?? '--';
  }
}

function isFilterActive(val) {
  return val !== '' && val != null;
}

export default function EarningsPage() {
  const { earnings, days, selectedDay, setSelectedDay, loading, error, prevWeek, nextWeek, thisWeek, timeZone, setTimeZone, todayKey } = useEarningsCalendar();
  const { add, remove, has } = useWatchlist();
  const [filters, setFilters] = useState(() => {
    try {
      const saved = sessionStorage.getItem('earnings-filters');
      return saved ? { ...DEFAULT_FILTERS, ...JSON.parse(saved) } : DEFAULT_FILTERS;
    } catch { return DEFAULT_FILTERS; }
  });
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [sortCol, setSortCol] = useState('score');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [visibleCols, setVisibleCols] = useState(() => new Set(DEFAULT_VISIBLE_COLUMNS));
  const [compact, setCompact] = useState(false);
  const [showColMenu, setShowColMenu] = useState(false);
  const colMenuRef = useRef(null);

  // Persist filters to sessionStorage (survives SPA navigation, clears on tab close)
  useEffect(() => {
    try { sessionStorage.setItem('earnings-filters', JSON.stringify(filters)); } catch {}
  }, [filters]);

  // Close column menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setShowColMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Visible column specs
  const visibleSpecs = useMemo(() =>
    COLUMN_SPECS.filter(col => col.alwaysVisible || visibleCols.has(col.key)),
    [visibleCols]
  );

  // Filter — completely independent of columns
  const filtered = useMemo(() => {
    return earnings.filter(e => {
      const mcap = e.marketCap;
      const price = e.price;
      // Market cap
      if (isFilterActive(filters.marketCapMin)) {
        if (mcap == null || mcap < Number(filters.marketCapMin)) return false;
      }
      if (isFilterActive(filters.marketCapMax)) {
        if (mcap == null || mcap > Number(filters.marketCapMax)) return false;
      }
      // Price
      if (isFilterActive(filters.minPrice)) {
        if (price == null || price < Number(filters.minPrice)) return false;
      }
      if (isFilterActive(filters.maxPrice)) {
        if (price == null || price > Number(filters.maxPrice)) return false;
      }
      // Time
      if (filters.time && e.hour !== filters.time) return false;
      // Search
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!e.symbol?.toLowerCase().includes(q) && !e.companyName?.toLowerCase().includes(q)) return false;
      }
      // Advanced filters
      if (isFilterActive(filters.minAvgVolume) && (e.avgVolume == null || e.avgVolume < Number(filters.minAvgVolume))) return false;
      if (isFilterActive(filters.minRvol) && (e.rvol == null || e.rvol < Number(filters.minRvol))) return false;
      if (isFilterActive(filters.maxFloat) && (e.floatShares == null || e.floatShares > Number(filters.maxFloat))) return false;
      if (isFilterActive(filters.minScore) && calcTradeScore(e) < Number(filters.minScore)) return false;
      return true;
    });
  }, [earnings, filters]);

  // Sort — depends only on filtered data and sort state, NOT on columns
  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    const spec = COLUMN_SPECS.find(c => c.key === sortCol);
    if (!spec) return filtered;
    const getValue = spec.sortValue || (row => row[sortCol]);
    return [...filtered].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [filtered, sortCol, sortDir]);

  const handleSort = useCallback((key) => {
    if (sortCol === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(key);
      setSortDir('desc');
    }
  }, [sortCol]);

  // Selection
  const toggleRow = useCallback((row) => {
    const key = `${row.symbol}-${row.date}`;
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedRows(prev => {
      if (prev.size === sorted.length && sorted.length > 0) return new Set();
      return new Set(sorted.map(r => `${r.symbol}-${r.date}`));
    });
  }, [sorted]);

  const allSelected = sorted.length > 0 && selectedRows.size === sorted.length;

  // Bulk add to watchlist
  const addSelectedToWatchlist = () => {
    const symbols = new Set();
    for (const key of selectedRows) {
      const sym = key.split('-')[0];
      if (!has(sym)) symbols.add(sym);
    }
    symbols.forEach(sym => add(sym, 'earnings'));
    setSelectedRows(new Set());
  };

  // Export CSV
  const exportCSV = () => {
    const colKeys = ALL_COLUMN_KEYS.filter(k => k !== 'select' && k !== 'watchlist');
    const colLabels = {
      score: 'Score', symbol: 'Symbol', companyName: 'Company', hour: 'Time',
      epsEstimate: 'EPS Est', epsActual: 'EPS Actual', surprisePercent: 'Surprise %',
      revenueEstimate: 'Rev Est', revenueActual: 'Rev Actual',
      marketCap: 'Market Cap', price: 'Price', changePercent: 'Change %',
      avgVolume: 'Avg Volume', volume: 'Volume', rvol: 'RVOL',
      floatShares: 'Float', sharesShort: 'Short', shortPercentOfFloat: 'SI%',
      preMarketChangePercent: 'PreMkt %', dist200MA: '200MA %', dist52WH: '52WH %',
      analystRating: 'Analyst',
    };
    const headers = colKeys.map(k => colLabels[k] || k);
    const rows = sorted.map(e => colKeys.map(k => {
      if (k === 'score') return calcTradeScore(e);
      if (k === 'hour') return (e.hour || '').toUpperCase();
      return e[k] ?? '';
    }));
    const csv = [headers, ...rows].map(r => r.map(v => typeof v === 'string' && v.includes(',') ? `"${v}"` : v).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `earnings-screener-${selectedDay || 'week'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rowClassName = (row) => {
    const score = calcTradeScore(row);
    let cls = '';
    if (row.epsActual != null && row.epsEstimate != null) {
      cls = row.epsActual > row.epsEstimate ? 'row--beat' : row.epsActual < row.epsEstimate ? 'row--miss' : '';
    } else {
      cls = 'row--upcoming';
    }
    if (score >= 5) cls += ' row--hot';
    if (selectedRows.has(`${row.symbol}-${row.date}`)) cls += ' row--selected';
    return cls;
  };

  // Column visibility labels
  const COL_LABELS = {
    score: 'Score', symbol: 'Symbol', companyName: 'Company', hour: 'Time',
    epsEstimate: 'EPS Est', epsActual: 'EPS Actual', surprisePercent: 'Surprise%',
    revenueEstimate: 'Rev Est', revenueActual: 'Rev Actual', marketCap: 'Mkt Cap',
    price: 'Price', changePercent: 'Change%', avgVolume: 'Avg Vol', volume: 'Volume',
    rvol: 'RVOL', floatShares: 'Float', sharesShort: 'Short', shortPercentOfFloat: 'SI%',
    preMarketChangePercent: 'PreMkt%', dist200MA: '200MA%', dist52WH: '52WH%',
    analystRating: 'Analyst',
  };

  const toggleColVisibility = (key) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const wlHelpers = { has, add, remove };

  return (
    <div className="earnings-page">
      <WeekSelector
        days={days}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        onPrev={prevWeek}
        onNext={nextWeek}
        onToday={thisWeek}
        todayKey={todayKey}
      />

      <div className="earnings-page__tz-toggle">
        <span className="earnings-page__tz-label">Time zone</span>
        <div className="earnings-page__tz-buttons">
          <button
            className={`btn-secondary btn-sm${timeZone === 'America/New_York' ? ' btn-secondary--active' : ''}`}
            onClick={() => setTimeZone('America/New_York')}
          >
            US / Eastern
          </button>
          <button
            className={`btn-secondary btn-sm${timeZone === 'Europe/London' ? ' btn-secondary--active' : ''}`}
            onClick={() => setTimeZone('Europe/London')}
            style={{ marginLeft: 6 }}
          >
            UK / London
          </button>
        </div>
      </div>

      <EarningsFilters filters={filters} onChange={setFilters} />

      {/* Toolbar */}
      <div className="earnings-page__toolbar">
        <span className="earnings-page__count">
          {loading ? <Loader2 size={16} className="spin" /> : `${sorted.length} earnings`}
          {selectedRows.size > 0 && (
            <button className="btn-primary btn-sm" onClick={addSelectedToWatchlist} style={{ marginLeft: 8 }}>
              <CheckSquare size={14} /> Add {selectedRows.size} to Watchlist
            </button>
          )}
        </span>
        <div className="earnings-page__actions">
          {/* Density toggle */}
          <button className="btn-icon-label" onClick={() => setCompact(c => !c)}
            title={compact ? 'Comfortable view' : 'Compact view'}>
            {compact ? <Plus size={14} /> : <Minus size={14} />}
            {compact ? 'Comfortable' : 'Compact'}
          </button>
          {/* Column visibility */}
          <div className="col-menu-wrapper" ref={colMenuRef}>
            <button className="btn-icon-label" onClick={() => setShowColMenu(v => !v)}>
              <Columns3 size={14} /> Columns
            </button>
            {showColMenu && (
              <div className="col-menu">
                {ALL_COLUMN_KEYS.filter(k => k !== 'select' && k !== 'watchlist').map(k => (
                  <label key={k} className="col-menu__item">
                    <input type="checkbox" checked={visibleCols.has(k)}
                      onChange={() => toggleColVisibility(k)} />
                    {COL_LABELS[k] || k}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="btn-secondary btn-sm" onClick={exportCSV}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">Failed to load earnings data: {error}</div>
      )}

      {/* Content: Table + Research Panel */}
      <div className="earnings-page__content">
        <div className={`earnings-page__table-wrap${selectedTicker ? ' earnings-page__table-wrap--narrow' : ''}`}>
          <div className={`table-wrapper es-table-wrapper${compact ? ' es-compact' : ''}`}>
            <table className="data-table es-table">
              <thead>
                <tr>
                  {visibleSpecs.map(col => (
                    <th
                      key={col.key}
                      onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
                      style={{ cursor: col.sortable !== false ? 'pointer' : 'default', textAlign: col.align || 'left' }}
                    >
                      {col.key === 'select' ? (
                        <input type="checkbox" checked={allSelected} onChange={toggleAll}
                          style={{ accentColor: 'var(--accent-blue)' }} />
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {col.label}
                          {sortCol === col.key && (
                            sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                          )}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr><td colSpan={visibleSpecs.length} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    {loading ? 'Loading earnings data…' : 'No earnings match your filters'}
                  </td></tr>
                ) : sorted.map(row => (
                  <tr key={`${row.symbol}-${row.date}`} className={rowClassName(row)}>
                    {visibleSpecs.map(col => (
                      <td key={col.key}
                        style={{ textAlign: col.align || 'left', ...(col.key === 'symbol' ? { cursor: 'pointer' } : {}) }}
                        onClick={col.key === 'symbol' ? () => setSelectedTicker(row.symbol) : undefined}
                      >
                        {col.key === 'select' ? (
                          <input type="checkbox" checked={selectedRows.has(`${row.symbol}-${row.date}`)}
                            onChange={() => toggleRow(row)} style={{ accentColor: 'var(--accent-blue)' }} />
                        ) : renderCell(col.key, row, wlHelpers)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {selectedTicker && (
          <EarningsResearchPanel
            symbol={selectedTicker}
            earningsRow={sorted.find(r => r.symbol === selectedTicker)}
            onClose={() => setSelectedTicker(null)}
          />
        )}
      </div>
    </div>
  );
}
