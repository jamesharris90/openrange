import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { RefreshCcw, Star, AlertCircle, Columns3, X, Search, Plus, Moon, Sun } from 'lucide-react';
import useWatchlist from '../hooks/useWatchlist';
import ExportButtons from '../components/shared/ExportButtons';
import { formatNumber, formatCurrency, formatVolume, formatMarketCap } from '../utils/formatters';
import FilterSection from '../components/screener/FilterSection';
import { filterSchema } from '../components/screener/filterSchema';
import { useAdvancedFilterStore } from '../store/advancedFilterStore';
import { useAppStore } from '../store/useAppStore';
import { authFetch } from '../utils/api';
import { apiJSON } from '@/config/api';
import Portal from '../components/shared/Portal';
import Card from '../components/shared/Card';
import { useShallow } from 'zustand/react/shallow';

const VIEWS = [
  { id: 'overview', label: 'Overview', viewParam: '111', columns: ['Ticker', 'Company', 'Sector', 'Industry', 'Country', 'Market Cap', 'P/E', 'Price', 'Change', 'Volume'] },
  { id: 'valuation', label: 'Valuation', viewParam: '121', columns: ['Ticker', 'Market Cap', 'P/E', 'Forward P/E', 'PEG', 'P/S', 'P/B', 'P/Cash', 'P/Free Cash Flow', 'Price', 'Change', 'Volume'] },
  { id: 'financial', label: 'Financial', viewParam: '161', columns: ['Ticker', 'Market Cap', 'Dividend Yield', 'Return on Assets', 'Return on Equity', 'Return on Invested Capital', 'Current Ratio', 'Quick Ratio', 'LT Debt/Equity', 'Total Debt/Equity', 'Gross Margin', 'Operating Margin', 'Profit Margin', 'Price', 'Change', 'Volume'] },
  { id: 'ownership', label: 'Ownership', viewParam: '131', columns: ['Ticker', 'Market Cap', 'Shares Outstanding', 'Shares Float', 'Insider Ownership', 'Insider Transactions', 'Institutional Ownership', 'Institutional Transactions', 'Short Float', 'Short Ratio', 'Average Volume', 'Price', 'Change', 'Volume'] },
  { id: 'performance', label: 'Performance', viewParam: '141', columns: ['Ticker', 'Performance (Week)', 'Performance (Month)', 'Performance (Quarter)', 'Performance (Half Year)', 'Performance (YTD)', 'Performance (Year)', 'Volatility (Week)', 'Volatility (Month)', 'Relative Volume', 'Average Volume', 'Price', 'Change', 'Volume'] },
  { id: 'technical', label: 'Technical', viewParam: '171', columns: ['Ticker', 'Beta', 'Average True Range', '20-Day Simple Moving Average', '50-Day Simple Moving Average', '200-Day Simple Moving Average', '52-Week High', '52-Week Low', 'Relative Strength Index (14)', 'Price', 'Change', 'Volume'] },
];

// All known columns across all views (for column picker)
const COMMON_COLUMNS = ['Ticker', 'Company', 'Price', 'Change', 'Volume', 'Market Cap', 'Sector', 'Industry', 'Country', 'P/E', 'Average Volume'];
const ALL_COLUMNS = [...new Set(VIEWS.flatMap(v => v.columns))];

const PAGE_SIZE = 100;

const IS_NUMERIC = /Price|Change|Volume|Cap|P\/E|PEG|ATR|Beta|RSI|Perf|Moving Average|High|Low|Ratio|Debt|Return|Margin|Dividend|Outstanding|Float|Own|Trans|Short|Cash|Free Cash|Relative/i;

const NEWS_ICONS = { hot: '\u{1F525}', recent: '\u23F0', today: '\u{1F4F0}', old: '\u{1F4C4}' };

function toNumber(value) {
  if (value == null) return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function getPrice(row) { return toNumber(row.Price); }
function getChange(row) {
  const n = Number(String(row.Change || '').replace('%', ''));
  return Number.isNaN(n) ? 0 : n;
}

function smartFormat(value, colName) {
  if (value == null || value === '') return '--';
  const str = String(value).trim();
  if (str.endsWith('%')) return str;
  const num = Number(str.replace(/,/g, ''));
  if (isNaN(num)) return str || '--';
  if (/Market Cap/i.test(colName)) return formatMarketCap(num);
  if (/Volume/i.test(colName) && !/Relative/i.test(colName)) return formatVolume(num);
  if (/^Price$/i.test(colName)) return formatCurrency(num);
  return formatNumber(num);
}

function sortRows(rows, sort) {
  if (!sort.column) return rows;
  const dir = sort.direction === 'asc' ? 1 : -1;
  const data = [...rows];
  data?.sort((a, b) => {
    let aVal = a[sort.column] ?? '';
    let bVal = b[sort.column] ?? '';
    if (sort.column === '_newsAge') {
      return dir * ((a._newsAge ?? Infinity) - (b._newsAge ?? Infinity));
    }
    const aNum = Number(String(aVal).replace(/[,%]/g, ''));
    const bNum = Number(String(bVal).replace(/[,%]/g, ''));
    if (!isNaN(aNum) && !isNaN(bNum) && aVal !== '' && bVal !== '') return dir * (aNum - bNum);
    return dir * String(aVal).localeCompare(String(bVal));
  });
  return data;
}

const SCHEMA_FIELDS = Object.values(filterSchema).flat();
const RANGE_FILTER_FIELDS = SCHEMA_FIELDS.filter(field => field.type === 'range' && field.dataKey);

function parseNumericLike(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!text || text === '--' || text === 'N/A') return null;

  const suffix = text.slice(-1).toUpperCase();
  const unitMultiplier = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : suffix === 'T' ? 1e12 : 1;
  const normalized = unitMultiplier === 1 ? text : text.slice(0, -1);

  const parsed = Number(normalized.replace(/[$,%\s,]/g, ''));
  if (Number.isNaN(parsed)) return null;
  return parsed * unitMultiplier;
}

function toPercent(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return Number(pct.toFixed(digits));
}

function formatPercentString(value, digits = 2) {
  const pct = toPercent(value, digits);
  return Number.isFinite(pct) ? `${pct.toFixed(digits)}%` : '';
}

function mapCanonicalRowToLegacy(canonical) {
  const price = Number(canonical?.price);
  const sma20 = Number(canonical?.sma20);
  const sma50 = Number(canonical?.sma50);
  const sma200 = Number(canonical?.sma200);

  const sma20Pct = Number.isFinite(price) && Number.isFinite(sma20) && sma20 !== 0
    ? ((price - sma20) / sma20) * 100
    : null;
  const sma50Pct = Number.isFinite(price) && Number.isFinite(sma50) && sma50 !== 0
    ? ((price - sma50) / sma50) * 100
    : null;
  const sma200Pct = Number.isFinite(price) && Number.isFinite(sma200) && sma200 !== 0
    ? ((price - sma200) / sma200) * 100
    : null;

  return {
    Ticker: canonical?.symbol || '',
    Company: canonical?.name || '',
    Sector: canonical?.sector || '',
    Industry: canonical?.industry || '',
    Country: canonical?.country || '',
    'Market Cap': canonical?.marketCap ?? null,
    'P/E': canonical?.pe ?? null,
    'Forward P/E': canonical?.forwardPE ?? canonical?.forwardPe ?? null,
    PEG: canonical?.pegRatio ?? canonical?.peg ?? null,
    'P/S': canonical?.priceToSales ?? canonical?.ps ?? null,
    'P/B': canonical?.priceToBook ?? canonical?.pb ?? null,
    'P/Cash': canonical?.priceToCash ?? null,
    'P/Free Cash Flow': canonical?.priceToFreeCashFlow ?? null,
    Price: canonical?.price ?? null,
    Change: formatPercentString(canonical?.changePercent),
    Volume: canonical?.volume ?? null,
    'Dividend Yield': formatPercentString(canonical?.dividendYield),
    'Return on Assets': formatPercentString(canonical?.roa),
    'Return on Equity': formatPercentString(canonical?.roe),
    'Return on Invested Capital': formatPercentString(canonical?.roic),
    'Current Ratio': canonical?.currentRatio ?? null,
    'Quick Ratio': canonical?.quickRatio ?? null,
    'LT Debt/Equity': canonical?.ltDebtEquity ?? null,
    'Total Debt/Equity': canonical?.totalDebtEquity ?? canonical?.debtToEquity ?? null,
    'Gross Margin': formatPercentString(canonical?.grossMargin),
    'Operating Margin': formatPercentString(canonical?.operatingMargin),
    'Profit Margin': formatPercentString(canonical?.netProfitMargin ?? canonical?.netMargin),
    'Shares Outstanding': canonical?.sharesOutstanding ?? null,
    'Shares Float': canonical?.floatShares ?? canonical?.sharesFloat ?? null,
    'Insider Ownership': formatPercentString(canonical?.insiderOwnership),
    'Insider Transactions': canonical?.insiderTransactions ?? null,
    'Institutional Ownership': formatPercentString(canonical?.institutionalOwnership),
    'Institutional Transactions': canonical?.institutionalTransactions ?? null,
    'Short Float': formatPercentString(canonical?.shortFloat),
    'Short Ratio': canonical?.shortRatio ?? null,
    'Average Volume': canonical?.avgVolume ?? null,
    'Performance (Week)': formatPercentString(canonical?.perfWeek),
    'Performance (Month)': formatPercentString(canonical?.perfMonth),
    'Performance (Quarter)': formatPercentString(canonical?.perfQuarter),
    'Performance (Half Year)': formatPercentString(canonical?.perfHalfYear),
    'Performance (YTD)': formatPercentString(canonical?.perfYtd),
    'Performance (Year)': formatPercentString(canonical?.perfYear),
    'Volatility (Week)': formatPercentString(canonical?.volatilityWeek ?? canonical?.volatility),
    'Volatility (Month)': formatPercentString(canonical?.volatilityMonth),
    'Relative Volume': canonical?.relativeVolume ?? canonical?.rvol ?? null,
    Beta: canonical?.beta ?? null,
    'Average True Range': canonical?.atr ?? null,
    '20-Day Simple Moving Average': formatPercentString(sma20Pct),
    '50-Day Simple Moving Average': formatPercentString(sma50Pct),
    '200-Day Simple Moving Average': formatPercentString(sma200Pct),
    '52-Week High': canonical?.high52Week ?? null,
    '52-Week Low': canonical?.low52Week ?? null,
    'Relative Strength Index (14)': canonical?.rsi14 ?? null,
  };
}

function filterRowsByRangeValues(rows, values) {
  return rows.filter((row) => {
    for (const field of RANGE_FILTER_FIELDS) {
      const current = values[field.key];
      if (!current || typeof current !== 'object') continue;

      const minRaw = current.min;
      const maxRaw = current.max;
      if (!minRaw && !maxRaw) continue;

      const value = parseNumericLike(row[field.dataKey]);
      if (value == null) return false;

      const min = minRaw ? Number(minRaw) : null;
      const max = maxRaw ? Number(maxRaw) : null;

      if (min != null && !Number.isNaN(min) && value < min) return false;
      if (max != null && !Number.isNaN(max) && value > max) return false;
    }

    return true;
  });
}

const OVERVIEW_RENDERERS = {
  'Ticker': (value) => <span style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{value}</span>,
  'Company': (value) => (
    <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'bottom' }}>
      {value || '--'}
    </span>
  ),
  'Price': (value) => <span style={{ textAlign: 'right' }}>{formatCurrency(toNumber(value))}</span>,
  'Change': (value) => {
    const n = Number(String(value || '').replace('%', ''));
    return <span className={!isNaN(n) && n >= 0 ? 'text-positive' : 'text-negative'} style={{ fontWeight: 600 }}>{value || '--'}</span>;
  },
  'Volume': (value) => formatVolume(toNumber(value)),
  'Market Cap': (value) => formatMarketCap(toNumber(value)),
};

function NewsIcon({ ageHours, headline, source }) {
  const [showPopup, setShowPopup] = useState(false);
  if (ageHours == null) return <span className="screener-news-icon screener-news-icon--none">--</span>;
  let icon, cls;
  if (ageHours < 1) { icon = NEWS_ICONS.hot; cls = 'hot'; }
  else if (ageHours < 6) { icon = NEWS_ICONS.recent; cls = 'recent'; }
  else if (ageHours < 24) { icon = NEWS_ICONS.today; cls = 'today'; }
  else { icon = NEWS_ICONS.old; cls = 'old'; }

  return (
    <span className={`screener-news-icon screener-news-icon--${cls}`}
      onClick={e => { e.stopPropagation(); setShowPopup(p => !p); }}
      onMouseLeave={() => setShowPopup(false)}>
      {icon}
      {showPopup && headline && (
        <div className="screener-news-popup" onClick={e => e.stopPropagation()}>
          <div className="screener-news-popup__headline">{headline}</div>
          <div className="screener-news-popup__meta">{source} · {ageHours < 1 ? '<1h ago' : `${Math.round(ageHours)}h ago`}</div>
        </div>
      )}
    </span>
  );
}

/* Column picker with common columns listed + search for all */
function ColumnPicker({ activeView, currentVisibleCols, toggleColVisibility, allDataColumns }) {
  const [showMenu, setShowMenu] = useState(false);
  const [colSearch, setColSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Start with view columns, then add ALL_COLUMNS extras that aren't in view
  const viewCols = activeView.columns.filter(c => c !== 'Ticker');
  const extraCols = ALL_COLUMNS.filter(c => c !== 'Ticker' && !viewCols.includes(c));
  const dataCols = allDataColumns.filter(c => c !== 'Ticker' && !viewCols.includes(c) && !extraCols.includes(c));

  const allAvailable = [...viewCols, ...extraCols, ...dataCols];
  const filtered = colSearch.trim()
    ? allAvailable.filter(c => c.toLowerCase().includes(colSearch.toLowerCase()))
    : null;

  const displayList = filtered || viewCols;

  return (
    <div className="col-menu-wrapper" ref={ref}>
      <button className="pill-btn" onClick={() => setShowMenu(v => !v)}>
        <Columns3 size={14} /> Columns
      </button>
      {showMenu && (
        <div className="col-menu">
          <div className="col-menu__search">
            <Search size={12} />
            <input type="text" placeholder="Search columns..." value={colSearch}
              onChange={e => setColSearch(e.target.value)} />
            {colSearch && <button onClick={() => setColSearch('')}><X size={10} /></button>}
          </div>
          <div className="col-menu__list">
            {!filtered && <div className="col-menu__section-label">View Columns</div>}
            {displayList?.map(col => (
              <label key={col} className="col-menu__item">
                <input type="checkbox" checked={currentVisibleCols.has(col)} onChange={() => toggleColVisibility(col)} />
                {col}
              </label>
            ))}
            {filtered && filtered.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)' }}>No columns match "{colSearch}"</div>
            )}
            {!filtered && extraCols.length > 0 && (
              <>
                <div className="col-menu__section-label" style={{ marginTop: 8 }}>Other Available</div>
                {extraCols.slice(0, 10)?.map(col => (
                  <label key={col} className="col-menu__item">
                    <input type="checkbox" checked={currentVisibleCols.has(col)} onChange={() => toggleColVisibility(col)} />
                    {col}
                  </label>
                ))}
                {extraCols.length > 10 && (
                  <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-muted)' }}>
                    Search to find {extraCols.length - 10} more columns...
                  </div>
                )}
              </>
            )}
          </div>
          <button className="col-menu__reset" onClick={() => {
            // Reset to view defaults
            toggleColVisibility('__reset__');
          }}>
            Reset to Default
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdvancedScreenerPage() {
  const watchlist = useWatchlist();
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const [activeView, setActiveView] = useState(VIEWS[0]);
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ column: 'Change', direction: 'desc' });
  const [page, setPage] = useState(0);
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [newsMap, setNewsMap] = useState({});
  const [newTickers, setNewTickers] = useState(new Set());
  const prevTickersRef = useRef(new Set());
  const [refreshCountdown, setRefreshCountdown] = useState(60);
  const queryHydratedRef = useRef(false);
  const lastQueryRef = useRef('');

  const {
    activeTab,
    filterValues,
    appliedValues,
    applyNonce,
    serializeToQueryString,
    hydrateFromQueryString,
  } = useAdvancedFilterStore(
    useShallow((state) => ({
      activeTab: state.activeTab,
      filterValues: state.filterValues,
      appliedValues: state.appliedValues,
      applyNonce: state.applyNonce,
      serializeToQueryString: state.serializeToQueryString,
      hydrateFromQueryString: state.hydrateFromQueryString,
    }))
  );

  // Column visibility
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem('screener-visible-cols');
      if (saved) {
        const parsed = JSON.parse(saved);
        const result = {};
        for (const [viewId, cols] of Object.entries(parsed)) result[viewId] = new Set(cols);
        return result;
      }
    } catch {}
    return {};
  });

  // Track all unique column names we've seen in data
  const [allDataColumns, setAllDataColumns] = useState([]);

  useEffect(() => {
    try {
      const serialized = {};
      for (const [viewId, cols] of Object.entries(visibleCols)) serialized[viewId] = [...cols];
      localStorage.setItem('screener-visible-cols', JSON.stringify(serialized));
    } catch {}
  }, [visibleCols]);

  const currentVisibleCols = useMemo(() => visibleCols[activeView.id] || new Set(activeView.columns), [visibleCols, activeView]);
  const displayColumns = useMemo(() => {
    // Start with view columns, then add any extra visible cols
    const viewCols = activeView.columns.filter(col => col === 'Ticker' || currentVisibleCols.has(col));
    const extraVisible = [...currentVisibleCols].filter(col => !activeView.columns.includes(col));
    return [...viewCols, ...extraVisible];
  }, [activeView, currentVisibleCols]);

  function toggleColVisibility(col) {
    if (col === '__reset__') {
      setVisibleCols(prev => ({ ...prev, [activeView.id]: new Set(activeView.columns) }));
      return;
    }
    setVisibleCols(prev => {
      const viewCols = new Set(prev[activeView.id] || activeView.columns);
      viewCols.has(col) ? viewCols.delete(col) : viewCols.add(col);
      return { ...prev, [activeView.id]: viewCols };
    });
  }

  const sortedRows = useMemo(() => {
    const withNews = rows?.map(r => ({
      ...r,
      _newsAge: newsMap[r.Ticker]?.ageHours ?? null,
      _newsHeadline: newsMap[r.Ticker]?.headline ?? null,
      _newsSource: newsMap[r.Ticker]?.source ?? null,
    }));
    const filteredRows = filterRowsByRangeValues(withNews, appliedValues);
    return sortRows(filteredRows, sort);
  }, [rows, sort, newsMap, appliedValues]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = page * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, page]);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '1500' });

      const exchangeCode = String(appliedValues?.exchange || '').toLowerCase();
      if (exchangeCode === 'exch_nyse') params.set('exchange', 'NYSE');
      if (exchangeCode === 'exch_nasd') params.set('exchange', 'NASDAQ');
      if (exchangeCode === 'exch_amex') params.set('exchange', 'AMEX');

      const priceMin = appliedValues?.price?.min;
      const priceMax = appliedValues?.price?.max;
      const marketCapMin = appliedValues?.marketCap?.min;
      const marketCapMax = appliedValues?.marketCap?.max;
      const volumeMin = appliedValues?.volume?.min;
      const rvolMin = appliedValues?.relativeVolume?.min;
      const gapMin = appliedValues?.gapPercent?.min;
      const gapMax = appliedValues?.gapPercent?.max;
      const atrMin = appliedValues?.atrPercent?.min;
      const atrMax = appliedValues?.atrPercent?.max;
      const rsiMin = appliedValues?.rsi14?.min;
      const rsiMax = appliedValues?.rsi14?.max;
      const vwapMin = appliedValues?.vwapDistance?.min;
      const vwapMax = appliedValues?.vwapDistance?.max;
      const floatMin = appliedValues?.floatShares?.min;
      const floatMax = appliedValues?.floatShares?.max;
      const structureType = appliedValues?.structureType;
      const minGrade = appliedValues?.minGrade;
      const adaptToSpy = appliedValues?.adaptToSpy;

      if (priceMin) params.set('priceMin', String(priceMin));
      if (priceMax) params.set('priceMax', String(priceMax));
      if (marketCapMin) params.set('marketCapMin', String(marketCapMin));
      if (marketCapMax) params.set('marketCapMax', String(marketCapMax));
      if (volumeMin) params.set('volumeMin', String(volumeMin));
      if (rvolMin) params.set('rvolMin', String(rvolMin));
      if (gapMin) params.set('minGapPercent', String(gapMin));
      if (gapMax) params.set('maxGapPercent', String(gapMax));
      if (atrMin) params.set('minAtrPercent', String(atrMin));
      if (atrMax) params.set('maxAtrPercent', String(atrMax));
      if (rsiMin) params.set('minRsi14', String(rsiMin));
      if (rsiMax) params.set('maxRsi14', String(rsiMax));
      if (vwapMin) params.set('minVwapDistance', String(vwapMin));
      if (vwapMax) params.set('maxVwapDistance', String(vwapMax));
      if (floatMin) params.set('minFloat', String(floatMin));
      if (floatMax) params.set('maxFloat', String(floatMax));
      if (structureType) params.set('structures', String(structureType));
      if (minGrade) params.set('minGrade', String(minGrade));
      if (adaptToSpy === 'true') params.set('adaptFilters', 'true');

      const resp = await authFetch(`/api/v3/screener/technical?${params.toString()}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const payload = await resp.json();
      const rawRows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
      const newRows = rawRows?.map(mapCanonicalRowToLegacy);

      // Track all column names
      if (newRows.length > 0) {
        const cols = [...new Set(newRows.flatMap(r => Object.keys(r)))].filter(c => !c.startsWith('_'));
        setAllDataColumns(prev => {
          const merged = new Set([...prev, ...cols]);
          return merged.size === prev.length ? prev : [...merged];
        });
      }

      // Detect new tickers for highlight
      const currentTickers = new Set(newRows?.map(r => r.Ticker));
      const prevTickers = prevTickersRef.current;
      if (prevTickers.size > 0) {
        const fresh = new Set();
        for (const t of currentTickers) { if (!prevTickers.has(t)) fresh.add(t); }
        if (fresh.size > 0) {
          setNewTickers(fresh);
          setTimeout(() => setNewTickers(new Set()), 90000);
        }
      }
      prevTickersRef.current = currentTickers;

      setRows(newRows);
      setTotalCount(newRows.length);
    } catch (e) {
      setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [appliedValues]);

  // Fetch news freshness for visible page tickers
  const fetchNewsFreshness = useCallback(async (tickers) => {
    if (!tickers.length) return;
    try {
      const entries = await Promise.all(tickers?.map(async (ticker) => {
        try {
          const resp = await authFetch(`/api/v5/news?symbol=${encodeURIComponent(ticker)}&limit=1`);
          if (!resp.ok) return [ticker, null];
          const payload = await resp.json();
          const item = Array.isArray(payload) && payload.length ? payload[0] : null;
          if (!item) return [ticker, null];

          const headline = item.headline || item.title || item.summary || null;
          const source = item.source || 'Internal';
          const publishedRaw = item.publishedAt || item.publishedDate || item.time || null;
          const publishedMs = Date.parse(String(publishedRaw || ''));
          const ageHours = Number.isFinite(publishedMs)
            ? Math.max(0, (Date.now() - publishedMs) / (1000 * 60 * 60))
            : null;

          return [ticker, { ageHours, headline, source }];
        } catch {
          return [ticker, null];
        }
      }));

      const data = {};
      entries.forEach(([ticker, value]) => {
        if (ticker && value) data[ticker] = value;
      });

      if (Object.keys(data).length) {
        setNewsMap(prev => ({ ...prev, ...data }));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const tickers = pageRows?.map(r => r.Ticker).filter(Boolean);
    const missing = tickers.filter(t => !newsMap[t]);
    if (missing.length > 0) fetchNewsFreshness(missing);
  }, [pageRows, fetchNewsFreshness]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (queryHydratedRef.current) return;
    queryHydratedRef.current = true;
    hydrateFromQueryString(window.location.search);
  }, [hydrateFromQueryString]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const query = serializeToQueryString();
      if (query === lastQueryRef.current) return;
      lastQueryRef.current = query;
      const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
      window.history.replaceState(null, '', url);
    }, 250);

    return () => clearTimeout(timeout);
  }, [activeTab, filterValues, serializeToQueryString]);

  // Initial load + view change
  useEffect(() => {
    setPage(0);
    fetchData();
  }, [activeView.id, applyNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 60s
  useEffect(() => {
    setRefreshCountdown(60);
    const interval = setInterval(() => {
      setRefreshCountdown(prev => {
        if (prev <= 1) {
          fetchData(true);
          return 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  function handleApplyFilters() {
    setPage(0);
  }

  function handleClearFilters() {
    setPage(0);
  }

  function setSortColumn(col) {
    setSort(prev => {
      if (prev.column === col) return { column: col, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      return { column: col, direction: 'desc' };
    });
  }

  function handleTickerClick(ticker) {
    setSelectedTicker(prev => prev === ticker ? null : ticker);
  }

  const showStart = page * PAGE_SIZE + 1;
  const showEnd = Math.min((page + 1) * PAGE_SIZE, sortedRows.length);

  return (
    <div className="page-container screener-page space-y-3">
      {/* Header */}
      <div className="page-header screener-header">
        <div>
          <h2 className="m-0">Advanced Stock Screener</h2>
          <p className="muted mt-1">{totalCount.toLocaleString()} stocks loaded</p>
        </div>
        <div className="screener-header__actions">
          <span className="muted" style={{ fontSize: 12 }}>Refreshes in {refreshCountdown}s</span>
          <button className="btn-secondary btn-sm" onClick={() => fetchData()}><RefreshCcw size={14} /> Refresh</button>
        </div>
      </div>

      <FilterSection onApply={handleApplyFilters} onReset={handleClearFilters} />

      {error && (
        <Card style={{ marginBottom: 12 }}>
          <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} />
            <span>Could not load screener data: {error}</span>
          </div>
        </Card>
      )}

      {/* Toolbar: View tabs + Columns + Count — sits between filters and results */}
      <div className="screener-toolbar">
        <div className="screener-toolbar__tabs">
          {VIEWS?.map(view => (
            <button key={view.id} className={`tab${activeView.id === view.id ? ' active' : ''}`}
              onClick={() => setActiveView(view)}>
              {view.label}
            </button>
          ))}
        </div>
        <div className="screener-toolbar__right">
          <button className="pill-btn" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} Theme
          </button>
          <ColumnPicker
            activeView={activeView}
            currentVisibleCols={currentVisibleCols}
            toggleColVisibility={toggleColVisibility}
            allDataColumns={allDataColumns}
          />
          <span className="muted">{sortedRows.length.toLocaleString()} results</span>
        </div>
      </div>

      {/* Export row */}
      <div className="screener-export-row">
        <ExportButtons
          data={sortedRows}
          columns={[...displayColumns?.map(col => ({ key: col, label: col }))]}
          filename={`screener-${activeView.id}-${new Date().toISOString().split('T')[0]}`}
        />
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {sortedRows.length > 0 ? `Showing ${showStart}-${showEnd} of ${sortedRows.length.toLocaleString()}` : 'No results'}
        </span>
      </div>

      {/* Data table */}
      <Card className="screener-table-panel">
        <div className="table-wrapper overflow-x-auto" style={{ overflowX: 'auto' }}>
          <table className="data-table min-w-[900px]">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                {displayColumns?.map(col => {
                  const isNumeric = IS_NUMERIC.test(col);
                  return (
                    <th key={col} onClick={() => setSortColumn(col)} style={isNumeric ? { textAlign: 'right' } : undefined}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: isNumeric ? 'flex-end' : 'flex-start' }}>
                        <span>{col}</span>
                        {sort.column === col && <span className="muted">{sort.direction === 'asc' ? '\u25B2' : '\u25BC'}</span>}
                      </div>
                    </th>
                  );
                })}
                <th onClick={() => setSortColumn('_newsAge')} style={{ width: 50, textAlign: 'center', cursor: 'pointer' }}>
                  News {sort.column === '_newsAge' && <span className="muted">{sort.direction === 'asc' ? '\u25B2' : '\u25BC'}</span>}
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading && pageRows.length === 0 && (
                <tr><td colSpan={displayColumns.length + 2} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No results. Adjust filters and refresh.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={displayColumns.length + 2} style={{ padding: 20 }}>Loading screener data\u2026</td></tr>
              )}
              {!loading && pageRows?.map(row => {
                const inList = watchlist.has(row.Ticker);
                const renderers = activeView.id === 'overview' ? OVERVIEW_RENDERERS : null;
                const isNew = newTickers.has(row.Ticker);
                return (
                  <tr key={`${row.Ticker}-${row.Price}`} className={isNew ? 'row-highlight-new' : ''}>
                    <td style={{ width: 40, textAlign: 'center' }}>
                      <button className="btn-icon" title={inList ? 'Remove from watchlist' : 'Add to watchlist'}
                        onClick={e => { e.stopPropagation(); inList ? watchlist.remove(row.Ticker) : watchlist.add(row.Ticker, 'advanced-screener'); }}>
                        <Star size={16} fill={inList ? 'var(--accent-orange)' : 'none'} color={inList ? 'var(--accent-orange)' : 'var(--text-muted)'} />
                      </button>
                    </td>
                    {displayColumns?.map(col => {
                      const value = row[col];
                      const renderer = renderers?.[col];
                      const isNumeric = IS_NUMERIC.test(col);
                      const tickerCell = col === 'Ticker';

                      if (renderer) {
                        return (
                          <td key={col} style={{ ...(isNumeric ? { textAlign: 'right' } : {}), ...(tickerCell ? { cursor: 'pointer' } : {}) }}
                            onClick={tickerCell ? () => handleTickerClick(value) : undefined}>
                            {renderer(value, row)}
                          </td>
                        );
                      }

                      const display = isNumeric ? smartFormat(value, col) : (value || '--');
                      const changeClass = col === 'Change' ? (getChange(row) >= 0 ? 'text-positive' : 'text-negative') : '';
                      return (
                        <td key={col} className={changeClass}
                          style={{ ...(isNumeric ? { textAlign: 'right' } : {}), ...(tickerCell ? { cursor: 'pointer' } : {}) }}
                          onClick={tickerCell ? () => handleTickerClick(value) : undefined}>
                          {tickerCell ? <span style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{display}</span> : display}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center' }}>
                      <NewsIcon ageHours={row._newsAge} headline={row._newsHeadline} source={row._newsSource} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="screener-pagination">
          <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
          <div className="screener-pagination__pages">
            {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
              let pageNum;
              if (totalPages <= 10) pageNum = i;
              else if (page < 5) pageNum = i;
              else if (page > totalPages - 6) pageNum = totalPages - 10 + i;
              else pageNum = page - 5 + i;
              return (
                <button key={pageNum} className={`screener-pagination__page${pageNum === page ? ' active' : ''}`}
                  onClick={() => setPage(pageNum)}>
                  {pageNum + 1}
                </button>
              );
            })}
          </div>
          <button className="btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}

      {/* Deep Dive floating modal */}
      {selectedTicker && (
        <Portal>
          <div className="screener-dd-overlay" onClick={() => setSelectedTicker(null)}>
            <div className="screener-dd-modal" onClick={e => e.stopPropagation()}>
              <div className="screener-dd-modal__header">
                <h3>{selectedTicker} Deep Dive</h3>
                <button className="aiq-icon-btn" onClick={() => setSelectedTicker(null)}><X size={16} /></button>
              </div>
              <div className="screener-dd-modal__body">
                <ScreenerDeepDive ticker={selectedTicker} watchlist={watchlist} />
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

/* Lightweight deep dive for screener context */
function ScreenerDeepDive({ ticker, watchlist }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiJSON(`/api/earnings-research/${ticker}`)
      .then(d => { if (!cancelled) { setData(d); setError(null); } })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (loading) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>Loading research data...</div>;
  if (error) return <div style={{ padding: 20, color: 'var(--accent-red)' }}>Error: {error}</div>;
  if (!data) return null;

  const fmtCurrency = (v) => v != null ? `$${Number(v).toFixed(2)}` : '\u2014';
  const fmtMktCap = (v) => {
    if (!v) return '\u2014';
    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v}`;
  };

  const inWL = watchlist?.has(ticker);

  return (
    <div className="screener-dd-content">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{fmtCurrency(data?.price)}</span>
        <span style={{ color: 'var(--text-muted)' }}>{data?.name}</span>
        <button className="btn-icon" style={{ marginLeft: 'auto' }}
          onClick={() => inWL ? watchlist.remove(ticker) : watchlist.add(ticker, 'advanced-screener')}>
          <Star size={16} fill={inWL ? 'var(--accent-orange)' : 'none'} color={inWL ? 'var(--accent-orange)' : 'var(--text-muted)'} />
        </button>
      </div>

      {data?.setupScore && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, color: 'var(--text-secondary)' }}>Setup Score: {data?.setupScore.score}/100</div>
          {data?.setupScore.breakdown && Object.entries(data?.setupScore.breakdown)?.map(([key, val]) => (
            <div key={key} className="erp-score__item">
              <span className="erp-score__item-label">{key}</span>
              <div className="erp-score__item-bar">
                <div className="erp-score__item-fill" style={{ width: `${Math.min(100, (Number(val) / 20) * 100)}%`, background: 'var(--accent-blue)' }} />
              </div>
              <span className="erp-score__item-val">{val}</span>
            </div>
          ))}
        </div>
      )}

      {data?.company && (
        <div className="screener-dd-section">
          <div className="screener-dd-section__title">Company</div>
          <div className="aiq-dd-grid">
            <div className="aiq-stat-row"><span className="aiq-stat-row__label">Sector</span><span className="aiq-stat-row__value">{data?.company.sector || '\u2014'}</span></div>
            <div className="aiq-stat-row"><span className="aiq-stat-row__label">Industry</span><span className="aiq-stat-row__value">{data?.company.industry || '\u2014'}</span></div>
            <div className="aiq-stat-row"><span className="aiq-stat-row__label">Market Cap</span><span className="aiq-stat-row__value">{fmtMktCap(data?.company.marketCap)}</span></div>
          </div>
        </div>
      )}

      {data?.technicals?.available && (
        <div className="screener-dd-section">
          <div className="screener-dd-section__title">Technicals</div>
          <div className="aiq-dd-grid">
            <div className="aiq-stat-row"><span className="aiq-stat-row__label">RSI(14)</span><span className="aiq-stat-row__value">{data?.technicals.rsi?.toFixed(1) || '\u2014'}</span></div>
            <div className="aiq-stat-row"><span className="aiq-stat-row__label">ATR(14)</span><span className="aiq-stat-row__value">{data?.technicals.atr ? `$${data?.technicals.atr.toFixed(2)}` : '\u2014'}</span></div>
            <div className="aiq-stat-row"><span className="aiq-stat-row__label">Trend</span><span className="aiq-stat-row__value" style={{ color: data?.technicals.trend === 'bullish' ? 'var(--accent-green)' : data?.technicals.trend === 'bearish' ? 'var(--accent-red)' : undefined }}>{data?.technicals.trend || '\u2014'}</span></div>
          </div>
        </div>
      )}

      {data?.expectedMove?.available && (
        <div className="screener-dd-section">
          <div className="screener-dd-section__title">Expected Move</div>
          <div className="aiq-dd-grid">
            <div className="aiq-stat-row"><span className="aiq-stat-row__label">Range</span><span className="aiq-stat-row__value">${data?.expectedMove.rangeLow} – ${data?.expectedMove.rangeHigh}</span></div>
            <div className="aiq-stat-row"><span className="aiq-stat-row__label">IV</span><span className="aiq-stat-row__value">{data?.expectedMove.ivPercent ? `${data?.expectedMove.ivPercent}%` : '\u2014'}</span></div>
          </div>
        </div>
      )}

      {data?.sentiment && (
        <div className="screener-dd-section">
          <div className="screener-dd-section__title">Analyst Sentiment</div>
          <div className="aiq-dd-grid">
            <div className="aiq-stat-row"><span className="aiq-stat-row__label">Rating</span><span className="aiq-stat-row__value">{data?.sentiment.recommendationKey || '\u2014'}</span></div>
            <div className="aiq-stat-row"><span className="aiq-stat-row__label">Target</span><span className="aiq-stat-row__value">{data?.sentiment.targetMeanPrice ? fmtCurrency(data?.sentiment.targetMeanPrice) : '\u2014'}</span></div>
            <div className="aiq-stat-row"><span className="aiq-stat-row__label">Upside</span><span className="aiq-stat-row__value" style={{ color: data?.sentiment.targetVsPrice > 0 ? 'var(--accent-green)' : data?.sentiment.targetVsPrice < 0 ? 'var(--accent-red)' : undefined }}>{data?.sentiment.targetVsPrice != null ? `${data?.sentiment.targetVsPrice > 0 ? '+' : ''}${data?.sentiment.targetVsPrice}%` : '\u2014'}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
