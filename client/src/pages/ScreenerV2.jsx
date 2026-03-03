// ScreenerV2 — Full market intelligence screener
// All calculations are backend-computed; this component is display-only.
// Features: 40+ columns, grouped column picker, 60s auto-refresh,
//           new-row highlight (5 min), watchlist stars, Gap/RVOL filters.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../utils/api';

// ─── Column definitions ────────────────────────────────────────────────────────

const COLUMN_GROUPS = {
  Core: [
    { key: 'symbol',         label: 'Symbol',     sortable: true  },
    { key: 'price',          label: 'Price',      sortable: true  },
    { key: 'changePercent',  label: 'Change %',   sortable: true  },
    { key: 'volume',         label: 'Volume',     sortable: true  },
    { key: 'relativeVolume', label: 'Rel Vol',    sortable: true  },
    { key: 'marketCap',      label: 'Mkt Cap',    sortable: true  },
    { key: 'exchange',       label: 'Exchange',   sortable: false },
    { key: 'sector',         label: 'Sector',     sortable: false },
  ],
  Intraday: [
    { key: 'gapPercent',              label: 'Gap %',       sortable: true  },
    { key: 'open',                    label: 'Open',        sortable: true  },
    { key: 'high',                    label: 'High',        sortable: true  },
    { key: 'low',                     label: 'Low',         sortable: true  },
    { key: 'prevClose',               label: 'Prev Close',  sortable: true  },
    { key: 'dollarVolume',            label: '$ Volume',    sortable: true  },
    { key: 'atrPercent',              label: 'ATR %',       sortable: true  },
    { key: 'return1D',                label: '1D Return',   sortable: true  },
    { key: 'intradayMoveFromOpenPercent', label: 'Move/Open %', sortable: true },
  ],
  Technical: [
    { key: 'rsi14',               label: 'RSI 14',     sortable: true  },
    { key: 'macd',                label: 'MACD',       sortable: true  },
    { key: 'ema9',                label: 'EMA 9',      sortable: true  },
    { key: 'ema20',               label: 'EMA 20',     sortable: true  },
    { key: 'ema50',               label: 'EMA 50',     sortable: true  },
    { key: 'ema200',              label: 'EMA 200',    sortable: true  },
    { key: 'emaStackState',       label: 'EMA Stack',  sortable: false },
    { key: 'aboveVwap',           label: 'Above VWAP', sortable: false },
    { key: 'vwapDistancePercent', label: 'VWAP Dist %',sortable: true  },
    { key: 'emaCompressionScore', label: 'EMA Squeeze',sortable: true  },
  ],
  '52-Week': [
    { key: 'high52w',                    label: '52W High',   sortable: true },
    { key: 'low52w',                     label: '52W Low',    sortable: true },
    { key: 'distanceFrom52wHighPercent', label: '52W High %', sortable: true },
    { key: 'distanceFrom52wLowPercent',  label: '52W Low %',  sortable: true },
    { key: 'return5D',                   label: '5D Return',  sortable: true },
    { key: 'return1M',                   label: '1M Return',  sortable: true },
  ],
  Fundamentals: [
    { key: 'pe',                           label: 'P/E',        sortable: true  },
    { key: 'beta',                         label: 'Beta',       sortable: true  },
    { key: 'insiderOwnershipPercent',      label: 'Insider %',  sortable: true  },
    { key: 'institutionalOwnershipPercent',label: 'Inst %',     sortable: true  },
    { key: 'grossMargin',                  label: 'Gross Mgn',  sortable: true  },
    { key: 'debtToEquity',                 label: 'D/E Ratio',  sortable: true  },
  ],
  'News & Catalyst': [
    { key: 'newsCount24h',      label: 'News 24h',   sortable: true  },
    { key: 'newsRecencyMinutes',label: 'News Age',   sortable: true  },
    { key: 'newsSentimentScore',label: 'Sentiment',  sortable: true  },
    { key: 'hasRecentCatalyst', label: 'Catalyst',   sortable: false },
    { key: 'catalystType',      label: 'Cat. Type',  sortable: false },
    { key: 'gapWithCatalyst',   label: 'Gap+Cat',    sortable: false },
  ],
  'Analyst': [
    { key: 'consensusRating',        label: 'Rating',       sortable: false },
    { key: 'recentUpgradeDowngrade', label: 'Upgrade',      sortable: false },
    { key: 'priceTargetChangePercent',label: 'PT Chg %',    sortable: true  },
    { key: 'netRatingChange',        label: 'Net Chg',      sortable: true  },
  ],
  'Earnings': [
    { key: 'nextEarningsDate',      label: 'Next Earnings', sortable: false },
    { key: 'earningsSession',       label: 'Session',       sortable: false },
    { key: 'epsSurprisePercent',    label: 'EPS Surp %',   sortable: true  },
    { key: 'postEarningsMovePercent',label: 'Post-Earn %',  sortable: true  },
  ],
  Strategy: [
    { key: 'inPlayFlag',      label: 'In Play',    sortable: false },
    { key: 'highRvolFlag',    label: 'High RVOL',  sortable: false },
    { key: 'lowFloatFlag',    label: 'Low Float',  sortable: false },
    { key: 'momentumScore',   label: 'Momentum',   sortable: true  },
    { key: 'liquidityScore',  label: 'Liquidity',  sortable: true  },
    { key: 'structureScore',  label: 'Structure',  sortable: true  },
    { key: 'riskScore',       label: 'Risk',       sortable: true  },
  ],
};

const ALL_COLUMNS = Object.entries(COLUMN_GROUPS).flatMap(([group, cols]) =>
  cols.map(col => ({ ...col, group }))
);

const COL_MAP = Object.fromEntries(ALL_COLUMNS.map(c => [c.key, c]));

const DEFAULT_VISIBLE = [
  'symbol', 'price', 'changePercent', 'gapPercent',
  'volume', 'relativeVolume', 'marketCap', 'exchange',
];

// Text-aligned left columns
const LEFT_ALIGN_COLS = new Set([
  'symbol', 'exchange', 'sector', 'emaStackState', 'catalystType',
  'consensusRating', 'recentUpgradeDowngrade', 'nextEarningsDate', 'earningsSession',
]);

// Columns where color encodes sign (green/red)
const SIGNED_COLS = new Set([
  'changePercent', 'gapPercent', 'return1D', 'return5D', 'return1M',
  'vwapDistancePercent', 'distanceFrom52wHighPercent',
  'intradayMoveFromOpenPercent', 'epsSurprisePercent', 'postEarningsMovePercent',
  'priceTargetChangePercent', 'macd',
]);

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmtLarge(n) {
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3)  return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

function fmtAge(minutes) {
  if (!Number.isFinite(minutes)) return '-';
  if (minutes < 60)   return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

function fmtCell(row, key) {
  const v = row[key];
  switch (key) {
    // Price-like numbers
    case 'price': case 'open': case 'high': case 'low': case 'prevClose':
    case 'ema9':  case 'ema20': case 'ema50': case 'ema200':
    case 'high52w': case 'low52w':
      return typeof v === 'number' ? v.toFixed(2) : '-';

    // Percent numbers
    case 'changePercent': case 'gapPercent':
    case 'return1D': case 'return5D': case 'return1M':
    case 'atrPercent': case 'vwapDistancePercent':
    case 'distanceFrom52wHighPercent': case 'distanceFrom52wLowPercent':
    case 'intradayMoveFromOpenPercent':
    case 'insiderOwnershipPercent': case 'institutionalOwnershipPercent':
    case 'grossMargin': case 'debtToEquity':
    case 'epsSurprisePercent': case 'postEarningsMovePercent':
    case 'priceTargetChangePercent':
      return typeof v === 'number' ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '-';

    // 2dp numbers
    case 'relativeVolume': case 'beta': case 'pe':
    case 'macd': case 'emaCompressionScore':
    case 'newsSentimentScore': case 'netRatingChange':
      return typeof v === 'number' ? v.toFixed(2) : '-';

    // Integer scores
    case 'rsi14': case 'momentumScore': case 'liquidityScore':
    case 'structureScore': case 'riskScore': case 'newsCount24h':
      return typeof v === 'number' ? Math.round(v) : '-';

    // Large numbers
    case 'volume': case 'dollarVolume': case 'marketCap':
      return typeof v === 'number' ? fmtLarge(v) : '-';

    // Age
    case 'newsRecencyMinutes':
      return fmtAge(v);

    // Boolean flags
    case 'aboveVwap': case 'inPlayFlag': case 'highRvolFlag':
    case 'lowFloatFlag': case 'gapWithCatalyst': case 'hasRecentCatalyst':
      return v ? '✓' : '-';

    // String / enum / date
    default:
      if (v == null || v === '') return '-';
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (typeof v === 'number') return v.toFixed(2);
      return String(v);
  }
}

function signedClass(row, key) {
  if (!SIGNED_COLS.has(key)) return '';
  const v = typeof row[key] === 'number' ? row[key] : null;
  if (v == null) return '';
  if (v > 0) return 'text-emerald-500';
  if (v < 0) return 'text-red-500';
  return '';
}

// ─── Storage constants ─────────────────────────────────────────────────────────
const KEY_COLS     = 'sv2-cols';
const KEY_DARK     = 'sv2-dark';
const KEY_FILTERS  = 'sv2-filters';

const EXCHANGE_OPTIONS = ['All', 'NASDAQ', 'NYSE', 'AMEX'];
const PAGE_SIZE        = 25;
const AUTO_REFRESH_SEC = 60;
const HIGHLIGHT_TTL_MS = 5 * 60 * 1000;

const BLANK_FILTERS = {
  exchange: 'All', minPrice: '', maxPrice: '',
  minVolume: '', minMarketCap: '', minChangePercent: '',
  minRelativeVolume: '', minGapPercent: '',
};

function loadFilters() {
  try {
    const s = localStorage.getItem(KEY_FILTERS);
    return s ? { ...BLANK_FILTERS, ...JSON.parse(s) } : { ...BLANK_FILTERS };
  } catch { return { ...BLANK_FILTERS }; }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ScreenerV2() {
  const navigate = useNavigate();

  // Data
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(false);
  const [silentBusy, setSilentBusy] = useState(false);
  const [error, setError]           = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // Filters
  const [filters, setFilters]               = useState(loadFilters);
  const [appliedFilters, setAppliedFilters] = useState(loadFilters);

  // Columns
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const s = localStorage.getItem(KEY_COLS);
      const p = s ? JSON.parse(s) : null;
      if (Array.isArray(p) && p.length) return p;
    } catch {}
    return [...DEFAULT_VISIBLE];
  });
  const [showColMenu, setShowColMenu] = useState(false);

  // Sort
  const [sortConfig, setSortConfig] = useState({ key: 'changePercent', dir: 'desc' });

  // Dark mode
  const [darkMode, setDarkMode] = useState(() => {
    const on = localStorage.getItem(KEY_DARK) === 'true';
    if (on) document.documentElement.classList.add('dark');
    return on;
  });

  // New-row highlight tracking
  const prevSymbolsRef = useRef(new Set());
  const [highlighted, setHighlighted] = useState(new Map()); // symbol → timestamp

  // Watchlist
  const [watchlistSet, setWatchlistSet]     = useState(new Set());
  const [watchlistBusy, setWatchlistBusy]   = useState(new Set());

  // Auto-refresh countdown
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SEC);

  // Persist columns
  useEffect(() => {
    localStorage.setItem(KEY_COLS, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  // Persist filters
  useEffect(() => {
    localStorage.setItem(KEY_FILTERS, JSON.stringify(filters));
  }, [filters]);

  // Load watchlist on mount
  useEffect(() => {
    authFetch('/api/profile/watchlist')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data)) setWatchlistSet(new Set(data));
      })
      .catch(() => {});
  }, []);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async (page, af, silent = false) => {
    if (silent) setSilentBusy(true);
    else        setLoading(true);
    setError('');
    setSessionExpired(false);

    try {
      const p = new URLSearchParams({ page: String(page + 1), pageSize: String(PAGE_SIZE) });
      if (af.exchange && af.exchange !== 'All') p.set('exchange', af.exchange);
      if (af.minPrice)          p.set('minPrice',          af.minPrice);
      if (af.maxPrice)          p.set('maxPrice',          af.maxPrice);
      if (af.minVolume)         p.set('minVolume',         af.minVolume);
      if (af.minMarketCap)      p.set('minMarketCap',      af.minMarketCap);
      if (af.minChangePercent)  p.set('minChangePercent',  af.minChangePercent);
      if (af.minRelativeVolume) p.set('minRelativeVolume', af.minRelativeVolume);
      if (af.minGapPercent)     p.set('minGapPercent',     af.minGapPercent);

      const res = await authFetch(`/api/data/screener?${p.toString()}`, { cache: 'no-store' });

      if (res.status === 401) {
        setSessionExpired(true);
        setRows([]); setTotalCount(0); return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const payload = await res.json();
      const newRows = Array.isArray(payload.data) ? payload.data : [];

      // Detect newly-appearing symbols (only meaningful on same page/filters)
      if (prevSymbolsRef.current.size > 0 && silent) {
        const prevSet = prevSymbolsRef.current;
        const appeared = newRows.filter(r => !prevSet.has(r.symbol)).map(r => r.symbol);
        if (appeared.length > 0) {
          const now = Date.now();
          setHighlighted(prev => {
            const next = new Map(prev);
            appeared.forEach(s => next.set(s, now));
            for (const [sym, ts] of next) {
              if (now - ts > HIGHLIGHT_TTL_MS) next.delete(sym);
            }
            return next;
          });
        }
      }
      prevSymbolsRef.current = new Set(newRows.map(r => r.symbol));

      setRows(newRows);
      setTotalCount(Number.isFinite(payload.total) ? payload.total : 0);
      setLastRefreshed(new Date());
    } catch (err) {
      if (!silent) setError(err?.message || 'Failed to load screener data');
    } finally {
      setLoading(false);
      setSilentBusy(false);
    }
  }, []);

  // Initial + filter/page change
  useEffect(() => {
    fetchData(currentPage, appliedFilters);
    setCountdown(AUTO_REFRESH_SEC);
  }, [currentPage, appliedFilters, fetchData]);

  // 60-second auto-refresh (page 0 only)
  useEffect(() => {
    if (currentPage !== 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchData(0, appliedFilters, true);
          return AUTO_REFRESH_SEC;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [currentPage, appliedFilters, fetchData]);

  // Expire old highlights
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setHighlighted(prev => {
        const next = new Map([...prev].filter(([, ts]) => now - ts < HIGHLIGHT_TTL_MS));
        return next.size === prev.size ? prev : next;
      });
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const toggleDark = () => {
    document.documentElement.classList.toggle('dark');
    const on = document.documentElement.classList.contains('dark');
    localStorage.setItem(KEY_DARK, String(on));
    setDarkMode(on);
  };

  const applyFiltersNow = () => {
    setAppliedFilters({ ...filters });
    setCurrentPage(0);
  };

  const resetFilters = () => {
    setFilters({ ...BLANK_FILTERS });
    setAppliedFilters({ ...BLANK_FILTERS });
    setCurrentPage(0);
  };

  const toggleCol = (key) => {
    setVisibleColumns(prev => {
      if (prev.includes(key)) return prev.length === 1 ? prev : prev.filter(k => k !== key);
      return [...prev, key];
    });
  };

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const toggleWatchlist = async (symbol) => {
    if (watchlistBusy.has(symbol)) return;
    setWatchlistBusy(prev => new Set([...prev, symbol]));
    try {
      if (watchlistSet.has(symbol)) {
        await authFetch(`/api/profile/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
        setWatchlistSet(prev => { const n = new Set(prev); n.delete(symbol); return n; });
      } else {
        await authFetch('/api/profile/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol }),
        });
        setWatchlistSet(prev => new Set([...prev, symbol]));
      }
    } catch {}
    setWatchlistBusy(prev => { const n = new Set(prev); n.delete(symbol); return n; });
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const sortedRows = useMemo(() => {
    if (!sortConfig.key) return rows;
    const dir = sortConfig.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = Number(a[sortConfig.key]);
      const bv = Number(b[sortConfig.key]);
      if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
      if (!Number.isFinite(av)) return 1;
      if (!Number.isFinite(bv)) return -1;
      return dir * (av - bv);
    });
  }, [rows, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageStart  = totalCount === 0 ? 0 : currentPage * PAGE_SIZE + 1;
  const pageEnd    = Math.min((currentPage + 1) * PAGE_SIZE, totalCount);

  const pageButtons = useMemo(() => {
    const s = Math.max(1, Math.min(currentPage - 1, totalPages - 4));
    const e = Math.min(totalPages, s + 4);
    return Array.from({ length: e - s + 1 }, (_, i) => s + i);
  }, [currentPage, totalPages]);

  const INPUT_CLS = 'w-full text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-gray-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500';
  const LABEL_CLS = 'block text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">

      {/* New-row glow animation */}
      <style>{`
        @keyframes sv2-glow {
          0%   { background: rgba(34,197,94,0.14); outline: 1px solid rgba(34,197,94,0.6); }
          60%  { background: rgba(34,197,94,0.06); outline: 1px solid rgba(34,197,94,0.3); }
          100% { background: transparent; outline: none; }
        }
        .sv2-new { animation: sv2-glow 2s ease-out forwards; }
      `}</style>

      <div className="max-w-full px-4 py-5">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">Screener V2</h1>
            {silentBusy && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent inline-block" />
            )}
            {lastRefreshed && !silentBusy && (
              <span className="text-xs text-gray-400 tabular-nums">
                {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            {currentPage === 0 && (
              <span className="text-xs text-gray-400 tabular-nums">
                auto-refresh {countdown}s
              </span>
            )}
            <button
              className="rounded border border-gray-300 dark:border-gray-700 px-3 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={toggleDark}
            >
              {darkMode ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>

        {/* ── Alerts ──────────────────────────────────────────────────────── */}
        {sessionExpired && (
          <div className="mb-3 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-2.5 text-sm text-yellow-800 dark:text-yellow-300">
            Session expired.{' '}
            <button className="underline font-medium" onClick={() => navigate('/login')}>
              Log in again
            </button>
          </div>
        )}
        {error && (
          <div className="mb-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
            {error}{' '}
            <button className="underline font-medium" onClick={() => fetchData(currentPage, appliedFilters)}>
              Retry
            </button>
          </div>
        )}

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-4 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <div>
              <label className={LABEL_CLS}>Exchange</label>
              <select
                className={INPUT_CLS}
                value={filters.exchange}
                onChange={e => setFilters(p => ({ ...p, exchange: e.target.value }))}
              >
                {EXCHANGE_OPTIONS.map(ex => <option key={ex} value={ex}>{ex}</option>)}
              </select>
            </div>
            {[
              { f: 'minPrice',          lb: 'Min Price',   ph: '4'       },
              { f: 'maxPrice',          lb: 'Max Price',   ph: '40'      },
              { f: 'minVolume',         lb: 'Min Vol',     ph: '100000'  },
              { f: 'minMarketCap',      lb: 'Min Mkt Cap', ph: '5000000' },
              { f: 'minChangePercent',  lb: 'Min Chg %',   ph: '2'       },
              { f: 'minRelativeVolume', lb: 'Min RVOL',    ph: '1.5'     },
              { f: 'minGapPercent',     lb: 'Min Gap %',   ph: '3'       },
            ].map(({ f, lb, ph }) => (
              <div key={f}>
                <label className={LABEL_CLS}>{lb}</label>
                <input
                  className={INPUT_CLS}
                  value={filters[f]}
                  placeholder={ph}
                  onChange={e => setFilters(p => ({ ...p, [f]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && applyFiltersNow()}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm rounded-lg px-5 py-1.5 font-medium"
              onClick={applyFiltersNow}
            >
              Apply
            </button>
            <button
              className="border border-gray-300 dark:border-gray-700 text-sm rounded-lg px-4 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={resetFilters}
            >
              Reset
            </button>
          </div>
        </div>

        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400">
            {loading ? (
              'Loading…'
            ) : (
              <>
                Showing{' '}
                <strong className="text-gray-700 dark:text-gray-200">
                  {pageStart.toLocaleString()}–{pageEnd.toLocaleString()}
                </strong>{' '}
                of{' '}
                <strong className="text-gray-700 dark:text-gray-200">
                  {totalCount.toLocaleString()}
                </strong>{' '}
                tickers
              </>
            )}
          </span>

          {/* Column picker */}
          <div className="relative">
            <button
              className="flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-700 px-3 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => setShowColMenu(v => !v)}
            >
              ⊞ Columns ({visibleColumns.length})
            </button>

            {showColMenu && (
              <div
                className="absolute right-0 mt-2 w-80 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl z-30 p-4 max-h-[75vh] overflow-y-auto"
                onMouseLeave={() => setShowColMenu(false)}
              >
                {Object.entries(COLUMN_GROUPS).map(([group, cols]) => (
                  <div key={group} className="mb-3 last:mb-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                      {group}
                    </p>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                      {cols.map(col => (
                        <label
                          key={col.key}
                          className="flex items-center gap-1.5 py-0.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer hover:text-indigo-500 dark:hover:text-indigo-400"
                        >
                          <input
                            type="checkbox"
                            className="rounded text-indigo-600 focus:ring-indigo-500"
                            checked={visibleColumns.includes(col.key)}
                            onChange={() => toggleCol(col.key)}
                          />
                          {col.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  className="mt-2 w-full text-xs text-gray-400 hover:text-indigo-500 underline"
                  onClick={() => setVisibleColumns([...DEFAULT_VISIBLE])}
                >
                  Reset to defaults
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Table ───────────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 sticky top-0 z-10">
                <tr>
                  {/* Star column */}
                  <th className="w-8 px-2" />
                  {visibleColumns.map(key => {
                    const def = COL_MAP[key] || { label: key, sortable: false };
                    const isLeft = LEFT_ALIGN_COLS.has(key);
                    return (
                      <th
                        key={key}
                        className={`px-3 py-2.5 whitespace-nowrap ${isLeft ? 'text-left' : 'text-right'} ${def.sortable ? 'cursor-pointer select-none hover:text-indigo-500' : ''}`}
                        onClick={def.sortable ? () => handleSort(key) : undefined}
                      >
                        {def.label}
                        {def.sortable && sortConfig.key === key && (
                          <span className="ml-0.5 text-indigo-400">
                            {sortConfig.dir === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {loading && (
                  <tr>
                    <td colSpan={visibleColumns.length + 1} className="py-14 text-center">
                      <div className="flex justify-center">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                      </div>
                    </td>
                  </tr>
                )}

                {!loading && sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + 1} className="py-14 text-center text-gray-400 text-sm">
                      No tickers match the current filters.
                    </td>
                  </tr>
                )}

                {!loading && sortedRows.map(row => {
                  const isNew      = highlighted.has(row.symbol);
                  const inWL       = watchlistSet.has(row.symbol);
                  const wlBusy     = watchlistBusy.has(row.symbol);

                  return (
                    <tr
                      key={row.symbol}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors${isNew ? ' sv2-new' : ''}`}
                    >
                      {/* Watchlist star */}
                      <td className="w-8 px-2 text-center">
                        <button
                          disabled={wlBusy}
                          onClick={() => toggleWatchlist(row.symbol)}
                          className={`text-base leading-none transition-colors ${wlBusy ? 'opacity-40' : ''} ${inWL ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'}`}
                          title={inWL ? 'Remove from watchlist' : 'Add to watchlist'}
                        >
                          {inWL ? '★' : '☆'}
                        </button>
                      </td>

                      {visibleColumns.map(key => {
                        const isLeft   = LEFT_ALIGN_COLS.has(key);
                        const isSymbol = key === 'symbol';
                        const colorCls = signedClass(row, key);

                        return (
                          <td
                            key={`${row.symbol}-${key}`}
                            className={`px-3 py-2.5 whitespace-nowrap tabular-nums ${isLeft ? 'text-left' : 'text-right'} ${isSymbol ? 'font-semibold text-gray-900 dark:text-white' : `text-gray-700 dark:text-gray-300 ${colorCls}`}`}
                          >
                            {fmtCell(row, key)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Pagination ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500 dark:text-gray-400">
          <span className="tabular-nums text-xs">
            {pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of {totalCount.toLocaleString()}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-700 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
              disabled={currentPage === 0}
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            >
              ‹ Prev
            </button>
            {pageButtons.map(n => (
              <button
                key={n}
                className={`px-3 py-1 rounded border text-xs ${n === currentPage + 1 ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                onClick={() => setCurrentPage(n - 1)}
              >
                {n}
              </button>
            ))}
            <span className="px-1 text-xs">{currentPage + 1} / {totalPages}</span>
            <button
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-700 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            >
              Next ›
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
