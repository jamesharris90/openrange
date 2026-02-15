import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Play,
  RefreshCcw,
  Download,
  FilterX,
  Flame,
  BarChart2,
  Clock,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Star,
  ListChecks,
  Check,
} from 'lucide-react';
import useWatchlist from '../hooks/useWatchlist';
import { formatNumber, formatVolume, getTimeAgo } from '../utils/formatters';

const PAGE_SIZE = 20;
const MAX_STOCKS = 500;
const NEWS_BATCH = 150;

const DEFAULT_FILTERS = {
  tickersInput: '',
  searchText: '',
  priceMin: '',
  priceMax: '',
  relVolMin: '1',
  changeMin: '5',
  volumeMin: '1000000',
  catalysts: [],
  freshness: '',
};

const FRESHNESS_BUCKETS = {
  breaking: { label: 'Breaking', maxMinutes: 30 },
  lt1h: { label: '<1h', maxMinutes: 60 },
  lt6h: { label: '<6h', maxMinutes: 6 * 60 },
  lt24h: { label: '<24h', maxMinutes: 24 * 60 },
  lt2d: { label: '<2d', maxMinutes: 2 * 24 * 60 },
  lt5d: { label: '<5d', maxMinutes: 5 * 24 * 60 },
  lt7d: { label: '<7d', maxMinutes: 7 * 24 * 60 },
  lt14d: { label: '<14d', maxMinutes: 14 * 24 * 60 },
  lt30d: { label: '<30d', maxMinutes: 30 * 24 * 60 },
};

const CATALYST_OPTIONS = ['earnings', 'fda', 'product', 'merger', 'contract', 'upgrade', 'offering', 'guidance'];

function parseTickers(str) {
  return (str || '')
    .split(/[\s,]+/)
    .map(t => t.trim().toUpperCase())
    .filter(Boolean);
}

function parseFinvizDate(dateString) {
  if (!dateString) return null;
  const date = new Date(`${dateString} EST`);
  if (!Number.isNaN(date.getTime())) return date;
  const parts = dateString.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (parts) {
    const utcDate = new Date(Date.UTC(
      parseInt(parts[1], 10), parseInt(parts[2], 10) - 1, parseInt(parts[3], 10),
      parseInt(parts[4], 10), parseInt(parts[5], 10), parseInt(parts[6], 10)
    ));
    return new Date(utcDate.getTime() + 5 * 60 * 60 * 1000);
  }
  return null;
}

function newsBadge(date) {
  if (!date) return { icon: '🟢', ageLabel: '' };
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 30) return { icon: '🔥', ageLabel: `${minutes}m` };
  if (minutes < 60) return { icon: '🔴', ageLabel: `${minutes}m` };
  const hours = Math.floor(minutes / 60);
  if (hours < 6) return { icon: '🟠', ageLabel: `${hours}h` };
  if (hours < 24) return { icon: '🟡', ageLabel: `${hours}h` };
  const days = Math.floor(hours / 24);
  if (days < 7) return { icon: '🟢', ageLabel: `${days}d` };
  return { icon: '⚪', ageLabel: `${days}d` };
}

function buildLatestNewsMap(newsItems) {
  const map = {};
  (newsItems || []).forEach(item => {
    const tickers = parseTickers(item.Ticker || '');
    const parsedDate = parseFinvizDate(item.Date);
    tickers.forEach(ticker => {
      const existing = map[ticker];
      if (!parsedDate) return;
      if (!existing || parsedDate > existing.date) {
        const badge = newsBadge(parsedDate);
        map[ticker] = {
          title: item.Title,
          url: item.Url || item.URL || '#',
          date: parsedDate,
          ageLabel: badge.ageLabel,
          icon: badge.icon,
        };
      }
    });
  });
  return map;
}

function buildAllNewsMap(newsItems) {
  const map = {};
  (newsItems || []).forEach(item => {
    const tickers = parseTickers(item.Ticker || '');
    const parsedDate = parseFinvizDate(item.Date);
    tickers.forEach(ticker => {
      if (!map[ticker]) map[ticker] = [];
      const badge = newsBadge(parsedDate);
      map[ticker].push({
        title: item.Title,
        url: item.Url || item.URL || '#',
        date: parsedDate,
        ageLabel: badge.ageLabel,
        icon: badge.icon,
        source: item.Source || 'Finviz',
      });
    });
  });
  Object.values(map).forEach(arr => arr.sort((a, b) => (b.date || 0) - (a.date || 0)));
  return map;
}

function detectCatalysts(title) {
  const titleLower = (title || '').toLowerCase();
  const keywords = {
    earnings: ['earnings', 'q1', 'q2', 'q3', 'q4', 'quarterly', 'revenue', 'eps'],
    fda: ['fda', 'approval', 'clinical trial', 'phase', 'drug'],
    product: ['launches', 'unveils', 'introduces', 'new product', 'release'],
    merger: ['merger', 'acquisition', 'acquires', 'buys', 'takes over', 'm&a'],
    contract: ['wins contract', 'awarded', 'deal', 'partnership', 'agreement'],
    upgrade: ['upgrade', 'rating', 'initiated', 'target', 'buy', 'sell', 'downgrade'],
    offering: ['offering', 'ipo', 'secondary', 'raises', 'funding'],
    guidance: ['guidance', 'outlook', 'forecast', 'expects'],
  };
  const detected = [];
  Object.entries(keywords).forEach(([key, words]) => {
    if (words.some(w => titleLower.includes(w))) detected.push(key);
  });
  return detected.length ? detected : ['general'];
}

function numericChange(changeStr) {
  const n = parseFloat((changeStr || '').replace('%', ''));
  return Number.isNaN(n) ? 0 : n;
}

function numeric(val) {
  const n = Number(String(val || '').replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function sortRows(rows, sortState) {
  const data = [...rows];
  const { column, direction } = sortState;
  const dir = direction === 'asc' ? 1 : -1;
  const getVal = (row) => {
    switch (column) {
      case 'Ticker': return row.Ticker || '';
      case 'Price': return parseFloat(row.Price) || 0;
      case 'Change': return numericChange(row.Change);
      case 'Volume': return numeric(row.Volume);
      case 'RelVol': return parseFloat(row['Relative Volume'] || row['Rel Volume'] || 0) || 0;
      case 'Float': return parseFloat(String(row['Shares Float'] || row['Shs Float'] || row.Float || '').replace(/,/g, '')) || 0;
      case 'AvgVol': return (parseFloat(String(row['Average Volume'] || '').replace(/,/g, '')) || 0) * 1000;
      default: return 0;
    }
  };

  data.sort((a, b) => {
    const aVal = getVal(a);
    const bVal = getVal(b);
    if (typeof aVal === 'string' || typeof bVal === 'string') {
      return dir * aVal.toString().localeCompare(bVal.toString());
    }
    return dir * (aVal - bVal);
  });
  return data;
}

function computeTimeToOpen() {
  const now = new Date();
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const open = new Date(ny);
  open.setHours(9, 30, 0, 0);
  if (ny > open) open.setDate(open.getDate() + 1);
  while (open.getDay() === 0 || open.getDay() === 6) open.setDate(open.getDate() + 1);
  const diff = open - ny;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export default function PreMarketPage() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [scannerRows, setScannerRows] = useState([]);
  const [latestNewsMap, setLatestNewsMap] = useState({});
  const [allNewsMap, setAllNewsMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState({ text: 'Idle', tone: 'info' });
  const [sortState, setSortState] = useState({ column: 'Change', direction: 'desc' });
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());
  const [breakingNews, setBreakingNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(null);
  const [timeToOpen, setTimeToOpen] = useState(computeTimeToOpen());
  const [lastRun, setLastRun] = useState(null);
  const [spyQuote, setSpyQuote] = useState(null);
  const [autocomplete, setAutocomplete] = useState({ options: [], open: false });
  const [checklist, setChecklist] = useState(() => {
    try {
      const raw = localStorage.getItem('pmChecklist');
      return raw ? JSON.parse(raw) : [false, false, false, false, false];
    } catch (_) {
      return [false, false, false, false, false];
    }
  });

  const tickerInputRef = useRef(null);
  const autoTimer = useRef(null);
  const spyWidgetRef = useRef(null);
  const heatmapRef = useRef(null);
  const { add: addWatchlist, remove: removeWatchlist, has: hasWatchlist } = useWatchlist();

  const filteredRows = useMemo(() => {
    if (!scannerRows.length) return [];
    return scannerRows.filter(stock => {
      const change = numericChange(stock.Change);
      const relVol = parseFloat(stock['Relative Volume'] || stock['Rel Volume'] || '');
      const price = parseFloat(stock.Price || '');
      const vol = parseInt((stock.Volume || '').toString().replace(/,/g, ''), 10);
      const headline = latestNewsMap[stock.Ticker]?.title || '';
      const catalysts = detectCatalysts(headline);

      if (filters.priceMin && (Number.isNaN(price) || price < Number(filters.priceMin))) return false;
      if (filters.priceMax && (Number.isNaN(price) || price > Number(filters.priceMax))) return false;
      if (filters.relVolMin && (Number.isNaN(relVol) || relVol < Number(filters.relVolMin))) return false;
      if (filters.changeMin && (Number.isNaN(change) || Math.abs(change) < Number(filters.changeMin))) return false;
      if (filters.volumeMin && (Number.isNaN(vol) || vol < Number(filters.volumeMin))) return false;

      if (filters.catalysts.length && !catalysts.some(c => filters.catalysts.includes(c))) return false;

      if (filters.freshness) {
        const news = latestNewsMap[stock.Ticker];
        if (!news || !news.date) return false;
        const minutes = (Date.now() - news.date.getTime()) / 60000;
        const bucket = FRESHNESS_BUCKETS[filters.freshness];
        if (!bucket || minutes > bucket.maxMinutes) return false;
      }

      if (filters.searchText) {
        const text = filters.searchText.toLowerCase();
        const tickerMatch = stock.Ticker?.toLowerCase().includes(text);
        const headlineMatch = headline.toLowerCase().includes(text);
        if (!tickerMatch && !headlineMatch) return false;
      }

      return true;
    });
  }, [scannerRows, filters, latestNewsMap]);

  const sortedRows = useMemo(() => {
    const base = filteredRows.length ? filteredRows : scannerRows;
    return sortRows(base, sortState);
  }, [filteredRows, scannerRows, sortState]);

  const topGainer = useMemo(() => (sortedRows.length ? sortedRows[0] : null), [sortedRows]);

  const dedupeByTicker = (rows) => {
    const seen = new Set();
    return (rows || []).filter(row => {
      const ticker = row.Ticker;
      if (!ticker || seen.has(ticker)) return false;
      seen.add(ticker);
      return true;
    });
  };

  const fetchSupplementary = useCallback(async (tickerList) => {
    const supplementMap = {};
    if (!tickerList.length) return supplementMap;
    const batchSize = 100;
    for (let i = 0; i < tickerList.length; i += batchSize) {
      const slice = tickerList.slice(i, i + batchSize).join(',');
      try {
        const [perfRes, ownRes] = await Promise.all([
          fetch(`/api/finviz/screener?v=141&o=-change&t=${slice}`),
          fetch(`/api/finviz/screener?v=131&o=-change&t=${slice}`),
        ]);

        if (perfRes.ok) {
          const perfData = await perfRes.json();
          (perfData || []).forEach(row => {
            if (!row.Ticker) return;
            if (!supplementMap[row.Ticker]) supplementMap[row.Ticker] = {};
            supplementMap[row.Ticker]['Relative Volume'] = row['Relative Volume'] || '';
            supplementMap[row.Ticker]['Average Volume'] = row['Average Volume'] || '';
            supplementMap[row.Ticker]['Volatility (Week)'] = row['Volatility (Week)'] || '';
          });
        }

        if (ownRes.ok) {
          const ownData = await ownRes.json();
          (ownData || []).forEach(row => {
            if (!row.Ticker) return;
            if (!supplementMap[row.Ticker]) supplementMap[row.Ticker] = {};
            supplementMap[row.Ticker]['Shares Float'] = row['Shares Float'] || '';
            supplementMap[row.Ticker]['Short Float'] = row['Short Float'] || '';
          });
        }
      } catch (e) {
        console.warn('Supplementary data fetch failed for batch', e);
      }
    }
    return supplementMap;
  }, []);

  const batchNewsRequests = useCallback((tickerList) => {
    const promises = [];
    for (let i = 0; i < tickerList.length; i += NEWS_BATCH) {
      const slice = tickerList.slice(i, i + NEWS_BATCH);
      const params = new URLSearchParams({ v: '3', c: '1', t: slice.join(',') });
      promises.push(
        fetch(`/api/finviz/news-scanner?${params.toString()}`)
          .then(res => (res.ok ? res.json() : []))
          .catch(() => [])
      );
    }
    return promises;
  }, []);

  const handleRunScanner = useCallback(async () => {
    const tickers = parseTickers(filters.tickersInput);
    setLoading(true);
    setError(null);
    setStatus({ text: 'Running live pre-market scanner...', tone: 'info' });
    setSelected(new Set());
    setExpanded(new Set());

    try {
      let offset = 0;
      const rows = [];
      let errorCode = null;
      while (rows.length < MAX_STOCKS) {
        const params = new URLSearchParams({ v: '111', o: '-change', r: offset + 1, f: 'sh_avgvol_o100' });
        if (tickers.length) params.set('t', tickers.join(','));
        const res = await fetch(`/api/finviz/screener?${params.toString()}`);
        if (!res.ok) { errorCode = res.status; break; }
        const page = await res.json();
        if (!page || !page.length) break;
        rows.push(...page);
        if (page.length < PAGE_SIZE || tickers.length) break;
        offset += PAGE_SIZE;
      }

      const deduped = dedupeByTicker(rows).slice(0, MAX_STOCKS);
      if (!deduped.length && errorCode) throw new Error(`Screener HTTP ${errorCode}`);

      const allTickers = (tickers.length ? tickers : deduped.map(s => s.Ticker)).filter(Boolean);
      const [supplementMap, ...newsResults] = await Promise.all([
        fetchSupplementary(allTickers),
        ...batchNewsRequests(allTickers),
      ]);

      deduped.forEach(stock => {
        const supp = supplementMap[stock.Ticker];
        if (supp) Object.assign(stock, supp);
      });

      const news = newsResults.flat();
      const latestMap = buildLatestNewsMap(news);
      const allMap = buildAllNewsMap(news);

      setScannerRows(deduped);
      setLatestNewsMap(latestMap);
      setAllNewsMap(allMap);
      setLastRun(new Date().toISOString());

      if (errorCode) {
        setStatus({ text: `Partial load: ${deduped.length} stocks (stopped at screener HTTP ${errorCode}).`, tone: 'error' });
      } else {
        setStatus({ text: `Loaded ${deduped.length} stocks${tickers.length ? ` for ${tickers.join(', ')}` : ''}.`, tone: 'success' });
      }
    } catch (err) {
      console.error('Live scanner fetch failed', err);
      setError(err.message);
      setStatus({ text: `Failed to run scanner: ${err.message}`, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [filters.tickersInput, fetchSupplementary, batchNewsRequests]);

  const exportLiveNews = useCallback((format = 'csv') => {
    const source = (filteredRows && filteredRows.length) ? filteredRows : scannerRows;
    if (!source || !source.length) {
      setStatus({ text: 'Run the live scanner before exporting.', tone: 'error' });
      return;
    }

    const rows = source.map(stock => {
      const news = latestNewsMap[stock.Ticker];
      return {
        ticker: stock.Ticker,
        price: stock.Price,
        change: stock.Change,
        volume: stock.Volume,
        relVol: stock['Relative Volume'] || stock['Rel Volume'] || '',
        float: stock['Shares Float'] || stock['Shs Float'] || stock.Float || '',
        avgVol: stock['Average Volume'] || '',
        headline: news?.title || '',
        age: news?.ageLabel || '',
        url: news?.url || '',
      };
    });

    if (format === 'text') {
      const text = rows.map(r => `${r.ticker} | ${r.price} | ${r.change} | ${r.relVol} | ${r.float} | ${r.headline} | ${r.age} | ${r.url}`).join('\n');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'premarket-scanner.txt';
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    const header = ['Ticker', 'Price', 'Change', 'Volume', 'Rel Vol', 'Float', 'Avg Vol', 'Headline', 'Age', 'Link'];
    const csvLines = [header.join(',')].concat(rows.map(r => [r.ticker, r.price, r.change, r.volume, r.relVol, r.float, r.avgVol, r.headline, r.age, r.url]
      .map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(',')));
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'premarket-scanner.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredRows, scannerRows, latestNewsMap]);

  const handleSort = (column) => {
    setSortState(prev => {
      if (prev.column === column) {
        return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { column, direction: 'desc' };
    });
  };

  const handleToggleSelect = (ticker) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelected(new Set(sortedRows.map(r => r.Ticker)));
    } else {
      setSelected(new Set());
    }
  };

  const handleAddSelectedToWatchlist = () => {
    selected.forEach(sym => addWatchlist(sym, 'premarket'));
    setSelected(new Set());
  };

  const toggleExpanded = (ticker) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker); else next.add(ticker);
      return next;
    });
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const toggleCatalyst = (key) => {
    setFilters(prev => {
      const set = new Set(prev.catalysts);
      if (set.has(key)) set.delete(key); else set.add(key);
      return { ...prev, catalysts: Array.from(set) };
    });
  };

  const handleFreshness = (key) => setFilters(prev => ({ ...prev, freshness: key || '' }));

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  const loadBreakingNews = useCallback(async () => {
    setNewsLoading(true);
    setNewsError(null);
    try {
      const res = await fetch('/api/news');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const news = await res.json();
      setBreakingNews(news || []);
    } catch (err) {
      setNewsError(err.message);
    } finally {
      setNewsLoading(false);
    }
  }, []);

  const loadSpyQuote = useCallback(async () => {
    try {
      const res = await fetch('/api/yahoo/quote?t=SPY');
      if (!res.ok) throw new Error('quote');
      const data = await res.json();
      setSpyQuote(data);
    } catch (e) {
      // ignore
    }
  }, []);

  const handleChecklistToggle = (idx) => {
    setChecklist(prev => {
      const next = [...prev];
      next[idx] = !next[idx];
      localStorage.setItem('pmChecklist', JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    handleRunScanner();
    loadBreakingNews();
    loadSpyQuote();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTimeToOpen(computeTimeToOpen()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(loadSpyQuote, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadSpyQuote]);

  useEffect(() => {
    if (!tickerInputRef.current) return undefined;
    const handler = () => {
      const raw = tickerInputRef.current.value;
      const parts = raw.split(',');
      const current = parts[parts.length - 1].trim();
      if (current.length < 2) {
        setAutocomplete({ options: [], open: false });
        return;
      }
      clearTimeout(autoTimer.current);
      autoTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/yahoo/search?q=${encodeURIComponent(current)}`);
          const results = await res.json();
          setAutocomplete({ options: results || [], open: true });
        } catch (e) {
          setAutocomplete({ options: [], open: false });
        }
      }, 250);
    };
    const el = tickerInputRef.current;
    el.addEventListener('input', handler);
    return () => el.removeEventListener('input', handler);
  }, []);

  useEffect(() => {
    const clickHandler = (e) => {
      if (!tickerInputRef.current) return;
      if (!tickerInputRef.current.parentElement.contains(e.target)) {
        setAutocomplete(prev => ({ ...prev, open: false }));
      }
    };
    document.addEventListener('click', clickHandler);
    return () => document.removeEventListener('click', clickHandler);
  }, []);

  useEffect(() => {
    if (!spyWidgetRef.current || spyWidgetRef.current.dataset.loaded) return;
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: 'AMEX:SPY',
      interval: '15',
      timezone: 'America/New_York',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(26, 31, 46, 0)',
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
    });
    const container = document.createElement('div');
    container.className = 'tradingview-widget-container__widget';
    spyWidgetRef.current.appendChild(container);
    spyWidgetRef.current.appendChild(script);
    spyWidgetRef.current.dataset.loaded = 'true';
  }, []);

  useEffect(() => {
    if (!heatmapRef.current || heatmapRef.current.dataset.loaded) return;
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js';
    script.type = 'text/javascript';
    script.async = true;
    script.textContent = JSON.stringify({
      exchanges: [],
      dataSource: 'SPX500',
      grouping: 'sector',
      blockSize: 'market_cap_basic',
      blockColor: 'change',
      locale: 'en',
      colorTheme: 'dark',
      hasTopBar: false,
      isDataSetEnabled: false,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      width: '100%',
      height: '100%',
    });
    const container = document.createElement('div');
    container.className = 'tradingview-widget-container__widget';
    heatmapRef.current.appendChild(container);
    heatmapRef.current.appendChild(script);
    heatmapRef.current.dataset.loaded = 'true';
  }, []);

  const renderHeadline = (stock) => {
    const news = latestNewsMap[stock.Ticker];
    if (!news) return '—';
    return (
      <span className="news-headline-inline">
        <span style={{ marginRight: 6 }}>{news.icon}</span>
        <a href={news.url} target="_blank" rel="noreferrer">
          {news.title}
        </a>
        {news.ageLabel && <span className="muted"> ({news.ageLabel})</span>}
      </span>
    );
  };

  const rowsToRender = sortedRows;

  return (
    <div className="page-container premarket-page">
      <div className="page-header">
        <div>
          <h2>Pre-Market Scanner</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>Live gapper feed with catalysts, filters, watchlist actions, and exports.</p>
          {lastRun && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Updated {getTimeAgo(lastRun)}</div>}
          {status.text && (
            <div style={{ marginTop: 6, color: status.tone === 'error' ? 'var(--accent-red)' : status.tone === 'success' ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
              {status.text}
            </div>
          )}
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={() => setShowFilters(s => !s)}>
            <SlidersHorizontal size={16} /> {showFilters ? 'Hide Filters' : 'Show Filters'}
          </button>
          <button className="btn-secondary" onClick={() => exportLiveNews('text')} title="Export as text">
            <Download size={16} /> Export Text
          </button>
          <button className="btn-secondary" onClick={() => exportLiveNews('csv')} title="Export CSV">
            <Download size={16} /> Export CSV
          </button>
          <button className="btn-primary" onClick={handleRunScanner} disabled={loading}>
            <Play size={16} /> {loading ? 'Running…' : 'Run Scanner'}
          </button>
        </div>
      </div>

      <div className="pm-stat-grid">
        <div className="pm-stat-card accent">
          <div className="pm-stat-label"><Flame size={14} /> Top Gainer</div>
          <div className="pm-stat-value">{topGainer ? topGainer.Ticker : '--'}</div>
          <div className="pm-stat-sub">{topGainer ? topGainer.Change : 'Pre-market movers'}</div>
        </div>
        <div className="pm-stat-card">
          <div className="pm-stat-label"><BarChart2 size={14} /> SPY Pre-Market</div>
          <div className="pm-stat-value">{spyQuote ? `$${spyQuote.price?.toFixed(2)}` : '$---'}</div>
          <div className="pm-stat-sub" style={{ color: spyQuote?.changePercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {spyQuote ? `${spyQuote.changePercent >= 0 ? '+' : ''}${spyQuote.changePercent?.toFixed(2)}%` : '---%'}
          </div>
        </div>
        <div className="pm-stat-card purple">
          <div className="pm-stat-label"><Clock size={14} /> Time to Open</div>
          <div className="pm-stat-value">{timeToOpen}</div>
          <div className="pm-stat-sub">US market 9:30 AM ET</div>
        </div>
      </div>

      <div className="pm-grid">
        <div className="panel">
          <details open={showFilters}>
            <summary className="pm-filter-toggle">
              <SlidersHorizontal size={16} /> Filters
            </summary>
            <div className="pm-filters">
              <div className="pm-filter-row">
                <div className="form-field">
                  <label>Tickers (optional)</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      ref={tickerInputRef}
                      type="text"
                      placeholder="e.g. INTC, AMD, TSLA"
                      value={filters.tickersInput}
                      onChange={e => handleFilterChange('tickersInput', e.target.value)}
                    />
                    {autocomplete.open && autocomplete.options.length > 0 && (
                      <div className="ticker-autocomplete">
                        {autocomplete.options.map(opt => (
                          <button
                            key={opt.symbol}
                            type="button"
                            className="ticker-autocomplete__item"
                            onClick={() => {
                              const raw = filters.tickersInput.split(',');
                              raw[raw.length - 1] = ` ${opt.symbol}`;
                              const next = raw.join(',').replace(/^\s+/, '');
                              handleFilterChange('tickersInput', next);
                              setAutocomplete({ options: [], open: false });
                              tickerInputRef.current?.focus();
                            }}
                          >
                            <strong>{opt.symbol}</strong>
                            <span>{opt.name}</span>
                            <span className="muted">{opt.exchange}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="form-field">
                  <label>Search headline or ticker</label>
                  <input
                    type="text"
                    placeholder="Filter by ticker or headline"
                    value={filters.searchText}
                    onChange={e => handleFilterChange('searchText', e.target.value)}
                  />
                </div>
              </div>

              <div className="pm-filter-row">
                <div className="form-field">
                  <label>Price Min</label>
                  <select value={filters.priceMin} onChange={e => handleFilterChange('priceMin', e.target.value)}>
                    <option value="">Any</option>
                    <option value="1">$1+</option>
                    <option value="2">$2+</option>
                    <option value="5">$5+</option>
                    <option value="10">$10+</option>
                    <option value="20">$20+</option>
                    <option value="50">$50+</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>Price Max</label>
                  <select value={filters.priceMax} onChange={e => handleFilterChange('priceMax', e.target.value)}>
                    <option value="">Any</option>
                    <option value="5">Under $5</option>
                    <option value="10">Under $10</option>
                    <option value="20">Under $20</option>
                    <option value="50">Under $50</option>
                    <option value="100">Under $100</option>
                    <option value="500">Under $500</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>Rel Vol</label>
                  <select value={filters.relVolMin} onChange={e => handleFilterChange('relVolMin', e.target.value)}>
                    <option value="">Any</option>
                    <option value="1">1x+</option>
                    <option value="2">2x+</option>
                    <option value="3">3x+</option>
                    <option value="5">5x+</option>
                    <option value="10">10x+</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>Change %</label>
                  <select value={filters.changeMin} onChange={e => handleFilterChange('changeMin', e.target.value)}>
                    <option value="">Any</option>
                    <option value="1">1%+</option>
                    <option value="2">2%+</option>
                    <option value="5">5%+</option>
                    <option value="10">10%+</option>
                    <option value="20">20%+</option>
                  </select>
                </div>
                <div className="form-field">
                  <label>Volume</label>
                  <select value={filters.volumeMin} onChange={e => handleFilterChange('volumeMin', e.target.value)}>
                    <option value="">Any</option>
                    <option value="100000">100K+</option>
                    <option value="500000">500K+</option>
                    <option value="1000000">1M+</option>
                    <option value="5000000">5M+</option>
                    <option value="10000000">10M+</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="form-field" style={{ marginBottom: 6 }}>
                  <label style={{ textTransform: 'uppercase', letterSpacing: '0.4px' }}>Catalysts</label>
                </div>
                <div className="pm-catalyst-row">
                  {CATALYST_OPTIONS.map(opt => {
                    const active = filters.catalysts.includes(opt);
                    return (
                      <button key={opt} type="button" className={`pill-btn ${active ? 'pill-btn--active' : ''}`} onClick={() => toggleCatalyst(opt)}>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="form-field" style={{ marginBottom: 6 }}>
                  <label style={{ textTransform: 'uppercase', letterSpacing: '0.4px' }}>News Freshness</label>
                </div>
                <div className="pm-freshness-row">
                  {Object.entries(FRESHNESS_BUCKETS).map(([key, bucket]) => (
                    <button
                      key={key}
                      type="button"
                      className={`pill-btn ${filters.freshness === key ? 'pill-btn--active' : ''}`}
                      onClick={() => handleFreshness(key)}
                    >
                      {bucket.label}
                    </button>
                  ))}
                  <button type="button" className={`pill-btn ${filters.freshness === '' ? 'pill-btn--active' : ''}`} onClick={() => handleFreshness('')}>
                    Clear
                  </button>
                </div>
              </div>

              <div className="pm-filter-actions">
                <button className="btn-primary" onClick={handleRunScanner} disabled={loading}>
                  <Play size={16} /> {loading ? 'Running…' : 'Run Scanner'}
                </button>
                <button className="btn-secondary" onClick={resetFilters}>
                  <FilterX size={14} /> Clear Filters
                </button>
              </div>
            </div>
          </details>

          {error && (
            <div className="panel" style={{ border: '1px solid var(--accent-red)', marginTop: 12 }}>
              <span style={{ color: 'var(--accent-red)' }}>Failed to load scanner: {error}</span>
            </div>
          )}

          <div className="pm-table" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={selected.size === rowsToRender.length && rowsToRender.length > 0} onChange={e => handleSelectAll(e.target.checked)} />
                  </th>
                  <th onClick={() => handleSort('Ticker')}>Ticker</th>
                  <th onClick={() => handleSort('Price')}>Price</th>
                  <th onClick={() => handleSort('Change')}>Change</th>
                  <th onClick={() => handleSort('Volume')}>Volume</th>
                  <th onClick={() => handleSort('RelVol')}>Rel Vol</th>
                  <th onClick={() => handleSort('Float')}>Float</th>
                  <th onClick={() => handleSort('AvgVol')}>Avg Vol</th>
                  <th>Headline</th>
                  <th style={{ width: 90 }}>News</th>
                </tr>
              </thead>
              <tbody>
                {loading && !rowsToRender.length && (
                  <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Loading pre-market scanner…</td></tr>
                )}
                {!loading && rowsToRender.length === 0 && (
                  <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No results. Adjust filters or refresh.</td></tr>
                )}
                {rowsToRender.map(row => {
                  const relVol = row['Relative Volume'] || row['Rel Volume'] || '--';
                  const floatVal = row['Shares Float'] || row['Shs Float'] || row.Float || '--';
                  const avgVol = row['Average Volume'] || '--';
                  const isExpanded = expanded.has(row.Ticker);
                  const newsList = allNewsMap[row.Ticker] || [];
                  return (
                    <React.Fragment key={row.Ticker}>
                      <tr>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(row.Ticker)}
                            onChange={() => handleToggleSelect(row.Ticker)}
                          />
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{row.Ticker}</td>
                        <td>{row.Price || '--'}</td>
                        <td style={{ color: numericChange(row.Change) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{row.Change || '--'}</td>
                        <td>{formatVolume(numeric(row.Volume))}</td>
                        <td>{relVol}</td>
                        <td>{floatVal}</td>
                        <td>{formatNumber(numeric(avgVol) * 1000)}</td>
                        <td>{renderHeadline(row)}</td>
                        <td>
                          {newsList.length > 1 && (
                            <button className="link-button" onClick={() => toggleExpanded(row.Ticker)}>
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {newsList.length} articles
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && newsList.slice(0, 20).map((item, idx) => (
                        <tr key={`${row.Ticker}-news-${idx}`} className="pm-subrow">
                          <td colSpan={10}>
                            <span style={{ marginRight: 6 }}>{item.icon}</span>
                            <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                            {item.ageLabel && <span className="muted"> ({item.ageLabel})</span>}
                            <span className="muted" style={{ marginLeft: 8 }}>{item.source}</span>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected.size > 0 && (
            <div className="pm-selection-bar">
              <span>{selected.size} selected</span>
              <button className="btn-primary" onClick={handleAddSelectedToWatchlist}>
                <Star size={14} /> Add to Watchlist
              </button>
              <button className="btn-secondary" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="panel-heading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ListChecks size={16} /> Pre-Market Checklist
                </div>
              </div>
              <div className="pm-checklist">
                {['Review AI Morning Briefing', 'Check Pre-Market Movers', 'Review Economic Calendar', 'Update Watchlist', 'Set Price Alerts'].map((item, idx) => (
                  <label key={item} className="pm-check-item">
                    <input type="checkbox" checked={checklist[idx]} onChange={() => handleChecklistToggle(idx)} />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="panel" style={{ padding: 12 }}>
            <div className="panel-heading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ExternalLink size={16} /> Breaking News
              </div>
              <button className="btn-icon" onClick={loadBreakingNews} title="Refresh"><RefreshCcw size={14} /></button>
            </div>
            <div className="pm-news-feed">
              {newsLoading && <div className="muted" style={{ padding: 12 }}>Loading news…</div>}
              {newsError && <div style={{ color: 'var(--accent-red)', padding: 12 }}>Failed to load news: {newsError}</div>}
              {!newsLoading && !newsError && breakingNews.slice(0, 30).map(item => {
                const date = new Date(item.datetime * 1000);
                const symbol = (item.symbol || item.related || '').split(',')[0].trim().toUpperCase();
                const checked = symbol && hasWatchlist(symbol);
                return (
                  <div key={`${item.id}-${item.url}`} className="pm-news-item" onClick={() => window.open(item.url, '_blank', 'noopener')}>
                    <div className="pm-news-title">{item.headline}</div>
                    <div className="pm-news-meta">
                      <span className="pm-news-symbol">{symbol || 'MKT'}</span>
                      <span className="pm-news-divider">•</span>
                      <span>{item.source}</span>
                      <span className="pm-news-divider">•</span>
                      <span>{getTimeAgo(date)}</span>
                      {symbol && (
                        <label className="pm-news-wl" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) addWatchlist(symbol, 'news'); else removeWatchlist(symbol);
                            }}
                          />
                          <span>WL</span>
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel" style={{ padding: 0 }}>
            <div className="widget-container" style={{ height: 340 }}>
              <div ref={spyWidgetRef} className="tradingview-widget-container" style={{ height: '100%', width: '100%' }} />
            </div>
          </div>

          <div className="panel" style={{ padding: 0 }}>
            <div className="widget-container" style={{ height: 320 }}>
              <div ref={heatmapRef} className="tradingview-widget-container" style={{ height: '100%', width: '100%' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
