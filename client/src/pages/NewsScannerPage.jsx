import { useEffect, useMemo, useState, useRef } from 'react';
import { RefreshCw, SlidersHorizontal, X, ExternalLink, Star, Download, Sun, Moon, BarChart3, Info } from 'lucide-react';
import useWatchlist from '../hooks/useWatchlist';
import TabbedFilterPanel from '../components/shared/TabbedFilterPanel';
import TradingViewChart from '../components/shared/TradingViewChart';
import NewsButton from '../components/shared/NewsButton';
import { authFetch } from '../utils/api';
import {
  parseTickers,
  detectCatalysts,
  parseFinvizDate,
  getTimeAgo,
  computeStockScore,
  buildBadges,
  toCsvValue,
} from '../features/news/NewsScannerLogic';
import {
  buildFilterDefaults,
} from '../features/news/FilterConfigs';
import { formatNumber, formatPercent } from '../utils/formatters';
import Card from '../components/shared/Card';
import { useAppStore } from '../store/useAppStore';

const FRESHNESS_MAP = {
  '15m': 0.25,
  '1h': 1,
  breaking: 1,
  '2h': 2,
  '6h': 6,
  '12h': 12,
  '24h': 24,
  '48h': 48,
  week: 168,
  month: 720,
};

function formatPriceRangeLabel(minValue, maxValue) {
  const hasMin = minValue !== '' && minValue != null;
  const hasMax = maxValue !== '' && maxValue != null;
  if (!hasMin && !hasMax) return '';
  const toDollar = (value) => `$${Number(value).toLocaleString()}`;
  if (hasMin && hasMax) return `${toDollar(minValue)} – ${toDollar(maxValue)}`;
  if (hasMin) return `≥ ${toDollar(minValue)}`;
  return `≤ ${toDollar(maxValue)}`;
}

function getCatalystInsight(label, description = '') {
  const key = String(label || '').toLowerCase();
  const fallback = {
    title: label || 'Catalyst Signal',
    definition: description || 'Event-driven catalyst with potential to shift intraday narrative and liquidity concentration.',
    source: 'Finviz headline stream + contextual signal engine',
    behaviour: 'Typically increases short-term volatility and directional commitment near key levels.',
    watch: 'Track opening range retention, RVOL persistence, and follow-through headlines.',
    risk: 'Headline fade and liquidity reversal risk if momentum does not confirm quickly.',
  };

  const map = {
    earnings: {
      title: 'Earnings Catalyst',
      definition: 'Quarterly results or guidance update creating immediate repricing pressure.',
      source: 'Company filing / earnings release',
      behaviour: 'Gap-and-go continuation or sharp mean-reversion around opening liquidity.',
      watch: 'Post-open volume trend, guidance tone, and break/hold of premarket extremes.',
      risk: 'Whipsaw risk when initial move conflicts with call commentary.',
    },
    guidance: {
      title: 'Guidance Revision',
      definition: 'Forward-looking estimate adjustment that changes valuation expectations.',
      source: 'Company update / earnings commentary',
      behaviour: 'Commonly drives trend extension when aligned with broader sector sentiment.',
      watch: 'Analyst revision flow and sustained relative strength versus sector peers.',
      risk: 'Fast retracement if revision is already priced in.',
    },
    upgrade: {
      title: 'Analyst Upgrade',
      definition: 'Rating/target change from major desks influencing institutional positioning.',
      source: 'Broker research desk publications',
      behaviour: 'Opening impulse followed by either continuation or lunchtime fade pattern.',
      watch: 'Tape quality above VWAP and consistency of bid support.',
      risk: 'Upgrade fatigue if volume confirmation is weak.',
    },
    offering: {
      title: 'Capital Offering',
      definition: 'Dilution or financing event affecting supply dynamics and sentiment.',
      source: 'Company financing announcement',
      behaviour: 'Often starts as downside pressure, then stabilizes if demand absorbs supply.',
      watch: 'Absorption near key support and recovery attempt back through VWAP.',
      risk: 'Extended drift lower from persistent supply overhang.',
    },
    reversal: {
      title: 'Reversal Candidate',
      definition: 'Potential inflection setup after exhaustion of one-sided move.',
      source: 'Price-action signal + catalyst context',
      behaviour: 'Failed-break structures can trigger sharp countertrend response.',
      watch: 'Failed continuation attempts and reclaim/loss of prior day levels.',
      risk: 'False reversal risk in strong trend sessions.',
    },
  };

  return map[key] || fallback;
}

function getScoreTone(percentOfMax) {
  if (percentOfMax < 30) return 'weak';
  if (percentOfMax < 60) return 'warn';
  if (percentOfMax < 85) return 'teal';
  return 'strong';
}

function buildScoreMetrics(stock) {
  const price = Number(stock?.Price) || 0;
  const change = Number((stock?.Change || '').replace('%', '')) || 0;
  const volume = Number(stock?.Volume) || 0;
  const relVol = Number(stock?.['Rel Volume'] || stock?.['Relative Volume']) || 0;
  const atr = Number(stock?.ATR || stock?.['ATR (14)']) || 0;

  const relVolPts = Math.min(relVol * 10, 25);
  const changePts = Math.min(change + 10, 20);
  const volumePts = Math.min((volume / 1_000_000) * 2, 20);
  const atrPts = Math.min(atr * 5, 15);
  const priceBandPts = price >= 5 && price <= 150 ? 10 : 0;
  const total = Math.max(0, Math.min(100, relVolPts + changePts + volumePts + atrPts + priceBandPts));

  const metrics = [
    { label: 'Relative Volume', value: relVolPts, max: 25, why: 'Participation intensity versus baseline flow.' },
    { label: 'Price Change', value: changePts, max: 20, why: 'Immediate directional repricing strength.' },
    { label: 'Volume', value: volumePts, max: 20, why: 'Liquidity support behind the move.' },
    { label: 'ATR', value: atrPts, max: 15, why: 'Expected intraday movement range.' },
    { label: 'Price-band Bonus', value: priceBandPts, max: 10, why: 'Tradable price zone for active execution.' },
  ];

  const strength = total >= 85 ? 'Strong' : total >= 60 ? 'Moderate' : 'Weak';

  return { total, strength, metrics };
}

function getLeftColumnWidth(tickerCount) {
  if (tickerCount === 1) return '15%';
  if (tickerCount === 2) return '15%';
  if (tickerCount >= 3 && tickerCount <= 4) return '25%';
  return '30%';
}

function buildChangeContext(stock) {
  const change = Number((stock?.Change || '').replace('%', ''));
  const volume = Number(stock?.Volume || 0);
  const avgVolume = Number(stock?.['Average Volume'] || stock?.['Avg Volume'] || 0);
  const price = Number(stock?.Price || 0);
  const dayHigh = Number(stock?.['Day High'] || stock?.High || 0);
  const dayLow = Number(stock?.['Day Low'] || stock?.Low || 0);

  const changeText = Number.isFinite(change)
    ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}% vs previous close`
    : 'Change vs previous close unavailable';

  const volumeText = avgVolume > 0
    ? `${(volume / avgVolume).toFixed(2)}x of 20-day average volume`
    : '20-day average volume unavailable';

  let intradayText = 'Intraday range position unavailable';
  if (price > 0 && dayHigh > dayLow) {
    const position = ((price - dayLow) / (dayHigh - dayLow)) * 100;
    intradayText = `${Math.max(0, Math.min(100, position)).toFixed(0)}% within intraday range`;
  }

  return {
    changeText,
    volumeText,
    intradayText,
  };
}

function formatLegacyDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function getItemDate(item) {
  if (item?.publishedAt) {
    const direct = new Date(item.publishedAt);
    if (!Number.isNaN(direct.getTime())) return direct;
  }
  return parseFinvizDate(item?.Date || '');
}

function mapCanonicalStock(row) {
  const price = Number(row?.price);
  const changePercent = Number(row?.changePercent);
  const rvol = Number(row?.relativeVolume ?? row?.rvol);
  const shortFloat = Number(row?.shortFloat);

  return {
    Ticker: row?.symbol || '',
    Price: Number.isFinite(price) ? price.toFixed(2) : '',
    Change: Number.isFinite(changePercent) ? `${(Math.abs(changePercent) <= 1 ? changePercent * 100 : changePercent).toFixed(2)}%` : '',
    Volume: Number.isFinite(Number(row?.volume)) ? Number(row.volume) : '',
    'Rel Volume': Number.isFinite(rvol) ? rvol.toFixed(2) : '',
    'Relative Volume': Number.isFinite(rvol) ? rvol.toFixed(2) : '',
    'Average Volume': Number.isFinite(Number(row?.avgVolume)) ? Number(row.avgVolume) : '',
    ATR: Number.isFinite(Number(row?.atr)) ? Number(row.atr).toFixed(2) : '',
    'ATR (14)': Number.isFinite(Number(row?.atr)) ? Number(row.atr).toFixed(2) : '',
    'Day High': Number.isFinite(Number(row?.dayHigh)) ? Number(row.dayHigh).toFixed(2) : '',
    'Day Low': Number.isFinite(Number(row?.dayLow)) ? Number(row.dayLow).toFixed(2) : '',
    High: Number.isFinite(Number(row?.dayHigh)) ? Number(row.dayHigh).toFixed(2) : '',
    Low: Number.isFinite(Number(row?.dayLow)) ? Number(row.dayLow).toFixed(2) : '',
    'Market Cap': Number.isFinite(Number(row?.marketCap)) ? Number(row.marketCap) : '',
    'Shares Float': Number.isFinite(Number(row?.floatShares ?? row?.sharesFloat)) ? Number(row.floatShares ?? row.sharesFloat) : '',
    'Shs Float': Number.isFinite(Number(row?.floatShares ?? row?.sharesFloat)) ? Number(row.floatShares ?? row.sharesFloat) : '',
    'Short Float': Number.isFinite(shortFloat)
      ? `${(Math.abs(shortFloat) <= 1 ? shortFloat * 100 : shortFloat).toFixed(2)}%`
      : '',
    'Short Ratio': Number.isFinite(Number(row?.shortRatio)) ? Number(row.shortRatio).toFixed(2) : '',
    Sector: row?.sector || '',
    Industry: row?.industry || '',
    'Earnings Date': row?.earningsDate || '',
  };
}

export default function NewsScannerPage() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const { add: addToWatchlist, remove: removeFromWatchlist, has: hasWatchlist } = useWatchlist();

  const [filters, setFilters] = useState(buildFilterDefaults);
  const [news, setNews] = useState([]);
  const [stockMap, setStockMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [panelStoriesVisible, setPanelStoriesVisible] = useState(5);
  const [panelState, setPanelState] = useState({
    open: false,
    type: '',
    cardKey: '',
    ticker: '',
    item: null,
    catalysts: [],
    badge: null,
    impact: null,
    score: 0,
  });

  const exportMenuRef = useRef(null);

  const parsedTickers = useMemo(() => parseTickers(filters.tickersInput), [filters.tickersInput]);

  const filteredNews = useMemo(() => {
    return (news || []).filter((item) => {
      const tickers = parseTickers(item.Ticker || '');
      const primary = tickers[0];
      const stock = stockMap[primary];
      const catalysts = detectCatalysts(item.Title || '');
      const date = getItemDate(item);

      if (filters.newsFreshness && filters.newsFreshness !== 'any') {
        const diffHrs = (Date.now() - date.getTime()) / (1000 * 60 * 60);
        const maxHrs = FRESHNESS_MAP[filters.newsFreshness];
        if (maxHrs && diffHrs > maxHrs) return false;
      }

      if (parsedTickers.length) {
        const matches = tickers.some((ticker) => parsedTickers.includes(ticker));
        if (!matches) return false;
      }

      if (filters.catalysts.length) {
        const matchesCatalyst = catalysts.some((catalyst) => filters.catalysts.includes(catalyst));
        if (!matchesCatalyst) return false;
      }

      if (stock) {
        const price = Number(stock.Price);
        const change = Number((stock.Change || '').replace('%', ''));
        const volume = Number(stock.Volume);
        const relVol = Number(stock['Rel Volume'] || stock['Relative Volume']);
        const score = item._score ?? computeStockScore(stock);

        if (filters.priceMin && price < Number(filters.priceMin)) return false;
        if (filters.priceMax && price > Number(filters.priceMax)) return false;
        if (filters.volumeMin && volume < Number(filters.volumeMin)) return false;
        if (filters.relVolMin && relVol < Number(filters.relVolMin)) return false;
        if (filters.scoreMin && score < Number(filters.scoreMin)) return false;
        if (filters.scoreMax && score > Number(filters.scoreMax)) return false;
        if (filters.changeMin && change < Number(filters.changeMin)) return false;
      }

      return true;
    });
  }, [filters, news, parsedTickers, stockMap]);

  const sortedNews = useMemo(() => {
    return [...filteredNews].sort((a, b) => {
      const da = getItemDate(a).getTime();
      const db = getItemDate(b).getTime();
      return db - da;
    });
  }, [filteredNews]);

  const activeCount = useMemo(() => {
    return Object.entries(filters).filter(([key, value]) => {
      if (key === 'catalysts') return value.length > 0;
      return value !== '' && value != null;
    }).length;
  }, [filters]);

  const activeFilterChips = useMemo(() => {
    const chips = [];
    const priceRangeLabel = formatPriceRangeLabel(filters.priceMin, filters.priceMax);
    if (priceRangeLabel) {
      chips.push({ key: 'priceRange', value: priceRangeLabel, label: `Price: ${priceRangeLabel}` });
    }
    Object.entries(filters).forEach(([key, value]) => {
      if (key === 'priceMin' || key === 'priceMax') return;
      if (key === 'catalysts' && Array.isArray(value) && value.length) {
        value.forEach((v) => chips.push({ key, value: v, label: `Catalyst: ${v}` }));
        return;
      }
      if ((key === 'tickersInput' || key === 'searchText') && value) {
        chips.push({ key, value, label: `${key === 'tickersInput' ? 'Tickers' : 'Search'}: ${value}` });
        return;
      }
      if (value !== '' && value != null && key !== 'tickersInput' && key !== 'searchText') {
        chips.push({ key, value, label: `${key}: ${value}` });
      }
    });
    return chips;
  }, [filters]);

  const panelStock = useMemo(() => stockMap[panelState.ticker] || null, [panelState.ticker, stockMap]);

  const panelStories = useMemo(() => {
    if (!panelState.ticker) return [];
    return sortedNews.filter((item) => parseTickers(item.Ticker || '').includes(panelState.ticker));
  }, [panelState.ticker, sortedNews]);

  useEffect(() => {
    fetchNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!news.length) return;
    setNews((prev) => prev.map((item) => {
      const tickers = parseTickers(item.Ticker || '');
      const stock = stockMap[tickers[0]];
      return { ...item, _score: item._score ?? computeStockScore(stock) };
    }));
  }, [stockMap, news.length]);

  useEffect(() => {
    function onDocClick(event) {
      if (!exportMenuRef.current) return;
      if (!exportMenuRef.current.contains(event.target)) setExportOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  async function fetchStockData(tickers) {
    if (!tickers.length) return {};
    try {
      const resp = await authFetch('/api/v3/screener/technical?limit=3000');
      if (!resp.ok) return {};
      const payload = await resp.json();
      const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
      const needed = new Set(tickers.map((ticker) => String(ticker || '').toUpperCase()));
      const result = {};
      rows.forEach((row) => {
        const symbol = String(row?.symbol || '').toUpperCase();
        if (!symbol || !needed.has(symbol)) return;
        result[symbol] = mapCanonicalStock(row);
      });
      return result;
    } catch {
      return {};
    }
  }

  async function fetchLatestBySymbol(symbols) {
    const out = {};
    await Promise.all(symbols.map(async (symbol) => {
      try {
        const resp = await authFetch(`/api/v5/news?symbol=${encodeURIComponent(symbol)}&limit=5`);
        if (!resp.ok) return;
        const items = await resp.json();
        if (!Array.isArray(items) || !items.length) return;
        const latest = items[0];
        out[symbol] = {
          headline: latest?.headline || latest?.title || latest?.summary || '',
          url: latest?.url || '#',
          source: latest?.source || 'Internal',
          publishedAt: latest?.publishedAt || latest?.publishedDate || null,
          summary: latest?.summary || '',
        };
      } catch {
      }
    }));
    return out;
  }

  async function fetchNews() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (filters.newsFreshness && filters.newsFreshness !== 'any') {
        const hoursBack = FRESHNESS_MAP[filters.newsFreshness];
        if (hoursBack) params.set('hoursBack', String(hoursBack));
      }

      const resp = await authFetch(`/api/v3/screener/news?${params.toString()}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const payload = await resp.json();
      const rawItems = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);

      const deduped = rawItems.map((item) => ({
        Ticker: item?.symbol || '',
        Title: item?.headline || '',
        Date: formatLegacyDate(item?.publishedDate || item?.publishedAt || ''),
        Source: item?.source || 'Internal',
        Url: item?.url || '#',
        publishedAt: item?.publishedDate || item?.publishedAt || null,
      }));

      const tickerSet = new Set();
      deduped.forEach((item) => parseTickers(item.Ticker || '').forEach((ticker) => ticker && tickerSet.add(ticker)));

      const symbols = Array.from(tickerSet);
      const [stocks, latestNews] = await Promise.all([
        fetchStockData(symbols),
        fetchLatestBySymbol(symbols),
      ]);

      const enriched = deduped.map((item) => {
        const primary = parseTickers(item.Ticker || '')[0];
        const latest = latestNews[primary] || null;
        return {
          ...item,
          Title: latest?.headline || item.Title,
          Url: latest?.url || item.Url,
          Source: latest?.source || item.Source,
          Date: latest?.publishedAt ? formatLegacyDate(latest.publishedAt) : item.Date,
          publishedAt: latest?.publishedAt || item.publishedAt,
          Summary: latest?.summary || '',
        };
      });

      const scored = enriched.map((item) => {
        const primary = parseTickers(item.Ticker || '')[0];
        const stock = stocks[primary];
        return { ...item, _score: computeStockScore(stock) };
      });
      setStockMap(stocks);
      setNews(scored);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    setFilters(buildFilterDefaults());
  }

  function removeFilterChip(chip) {
    if (chip.key === 'priceRange') {
      setFilters((prev) => ({ ...prev, priceMin: '', priceMax: '' }));
      return;
    }
    if (chip.key === 'catalysts') {
      setFilters((prev) => ({ ...prev, catalysts: prev.catalysts.filter((c) => c !== chip.value) }));
      return;
    }
    setFilters((prev) => ({ ...prev, [chip.key]: '' }));
  }

  function exportResults(format) {
    const data = sortedNews.length ? sortedNews : news;
    if (!data.length) return;
    const rows = [];
    data.forEach((item) => {
      const tickers = parseTickers(item.Ticker || '');
      const catalysts = detectCatalysts(item.Title || '').join('|');
      const url = item.Url || item.URL || '';
      const source = item.Source || '';
      const published = item.Date || '';
      if (!tickers.length) {
        rows.push({ ticker: 'N/A', headline: item.Title || '', url, catalysts, source, published });
      } else {
        tickers.forEach((ticker) => rows.push({ ticker, headline: item.Title || '', url, catalysts, source, published }));
      }
    });
    if (format === 'text') {
      const text = rows.map((r) => `${r.ticker} | ${r.headline} | ${r.url} | ${r.catalysts}`).join('\n');
      downloadBlob(text, 'text/plain', 'news-export.txt');
      return;
    }
    const header = ['Ticker', 'Headline', 'Link', 'Type', 'Source', 'Published'];
    const csvLines = [header.join(',')].concat(rows.map((r) => {
      return [r.ticker, r.headline, r.url, r.catalysts, r.source, r.published].map(toCsvValue).join(',');
    }));
    downloadBlob(csvLines.join('\n'), 'text/csv', 'news-export.csv');
  }

  function downloadBlob(content, mimeType, filename) {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function buildImpactAnalysis(item, stock, catalysts) {
    const primary = parseTickers(item.Ticker || '')[0] || 'Ticker';
    const relVol = Number(stock?.['Rel Volume'] || stock?.['Relative Volume'] || 0);
    const change = Number((stock?.Change || '').replace('%', '')) || 0;
    const related = parseTickers(item.Ticker || '').filter((ticker) => ticker !== primary).slice(0, 3);
    const sector = stock?.Sector || stock?.Industry || 'Broad market';

    return {
      definition: `${primary} is showing catalyst-driven flow with ${catalysts.join(', ')} context.`,
      reaction: `Intraday response is strongest when RVOL remains elevated (current: ${relVol ? relVol.toFixed(2) : 'N/A'}x).`,
      sector: `${sector} names may see sympathy if follow-through volume persists.`,
      watch: [
        `Hold directional move into the next 15–30m (${change >= 0 ? '+' : ''}${change.toFixed(2)}%).`,
        'Respect VWAP and prior day levels for continuation quality.',
      ],
      invalidators: [
        'Failure to sustain bid/offer pressure after first impulse.',
        'Rapid drop in RVOL below intraday participation threshold.',
      ],
      risk: [
        'Headline fade risk if follow-up headlines do not confirm.',
        'Liquidity vacuum risk around key intraday levels (VWAP/PDH/PDL).',
      ],
      related: related.length ? related : ['Watch sector leaders and ETF proxies for confirmation.'],
    };
  }

  function openPanel(type, payload) {
    setPanelStoriesVisible(5);
    setPanelState({
      open: true,
      type,
      cardKey: payload.cardKey || '',
      ticker: payload.ticker || '',
      item: payload.item || null,
      catalysts: payload.catalysts || [],
      badge: payload.badge || null,
      impact: payload.impact || null,
      score: payload.score || 0,
    });
  }

  function closePanel() {
    setPanelState({
      open: false,
      type: '',
      cardKey: '',
      ticker: '',
      item: null,
      catalysts: [],
      badge: null,
      impact: null,
      score: 0,
    });
  }

  function renderTickerChip(ticker, stock, score, catalystsForTicker, item, cardKey) {
    const change = stock ? Number((stock.Change || '').replace('%', '')) : null;
    const price = stock ? Number(stock.Price) : null;
    const inWatchlist = hasWatchlist(ticker);
    const changeContext = buildChangeContext(stock);
    const scoreStrength = score >= 61 ? 'strong' : score >= 31 ? 'moderate' : 'weak';
    const scoreMetrics = buildScoreMetrics(stock);
    const catalystWeighting = Math.min((catalystsForTicker?.length || 0) * 5, 20);

    return (
      <div className="ticker-chip ns-ticker-block" key={ticker}>
        <div className="ticker-chip__header ns-ticker-block__header">
          <button
            className="ticker-chip__symbol ns-ticker-pill"
            onClick={() => openPanel('details', { ticker, item, cardKey, score, catalysts: catalystsForTicker })}
          >
            {ticker}
          </button>
          <NewsButton
            variant={inWatchlist ? 'primary' : 'ghost'}
            size="sm"
            iconOnly
            className="ns-watchstar ns-watchstar--compact"
            icon={<Star size={14} fill={inWatchlist ? 'currentColor' : 'none'} />}
            title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
            onClick={(e) => {
              e.stopPropagation();
              inWatchlist ? removeFromWatchlist(ticker) : addToWatchlist(ticker, 'news');
            }}
          />
        </div>
        <div className="ticker-chip__meta ns-ticker-block__meta">
          <div className="ns-price-row">
            <span className="ticker-chip__price ns-price-value">{price != null && !Number.isNaN(price) ? `$${price.toFixed(2)}` : '--'}</span>
          </div>
          <div className="ns-ticker-inline-row ns-ticker-inline-row--bottom">
            <span className="ns-change-wrap">
              <span className={`ns-change-pill ${change >= 0 ? 'is-up' : 'is-down'}`}>
                {change >= 0 ? '↑' : '↓'} {change != null && !Number.isNaN(change) ? `${Math.abs(change).toFixed(2)}%` : '--'}
              </span>
              <span className="ns-change-tooltip" role="tooltip">
                <strong>Price Change Context</strong>
                <span>{changeContext.changeText}</span>
                <span>{changeContext.volumeText}</span>
                <span>{changeContext.intradayText}</span>
              </span>
            </span>
            <span className="ns-score-wrap" title="Heuristic score">
              <span className={`ns-score-circle ns-score-circle--${scoreStrength}`}>
                {Math.round(score)}
              </span>
              <span className="ns-score-circle__tooltip" role="tooltip">
                <strong>Heuristic Score</strong>
                <span>Relative Volume: {scoreMetrics.metrics[0]?.value.toFixed(1)} / 25</span>
                <span>Price Change: {scoreMetrics.metrics[1]?.value.toFixed(1)} / 20</span>
                <span>Volatility: {scoreMetrics.metrics[3]?.value.toFixed(1)} / 15</span>
                <span>Catalyst Weighting: {catalystWeighting.toFixed(1)} / 20</span>
                <span>Score blends liquidity, momentum, volatility, and catalyst intensity.</span>
              </span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  const panelTitle = panelState.type === 'behaviour'
    ? `${panelState.ticker || 'Ticker'} · Market Behaviour`
    : panelState.type === 'details'
      ? `${panelState.ticker || 'Ticker'} · View Details`
      : `${panelState.ticker || 'Ticker'} · Catalyst Insight`;

  const panelScore = buildScoreMetrics(panelStock);
  const panelCatalystInsight = getCatalystInsight(panelState.badge?.label || panelState.catalysts?.[0] || 'general', panelState.badge?.desc || '');

  return (
    <div className="page-container news-scanner-page space-y-3">
      <Card className="ns-command-shell">
        <div className="ns-command-bar">
          <div className="ns-heading">
            <h2 className="m-0">News Intelligence</h2>
            <p className="mt-1">Catalyst-driven market feed with contextual scoring and prioritisation.</p>
            {lastUpdated && <div className="muted text-xs">Updated {getTimeAgo(lastUpdated)}</div>}
            <div className="ns-active-filters ns-active-filters--header">
              {activeFilterChips.length === 0 && <span className="muted">No active filters</span>}
              {activeFilterChips.map((chip) => (
                <button key={`${chip.key}-${chip.value}`} className="ns-filter-chip" onClick={() => removeFilterChip(chip)}>
                  {chip.label} <X size={12} />
                </button>
              ))}
            </div>
          </div>
          <div className="page-actions ns-command-actions">
            <NewsButton variant="primary" onClick={fetchNews} disabled={loading} icon={<RefreshCw size={16} strokeWidth={2} />}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </NewsButton>
            <div className="ns-export-wrap" ref={exportMenuRef}>
              <NewsButton variant="secondary" onClick={() => setExportOpen((v) => !v)} icon={<Download size={16} strokeWidth={2} />}>
                Export
              </NewsButton>
              {exportOpen && (
                <div className="ns-export-menu">
                  <button className="ns-export-item" onClick={() => { exportResults('text'); setExportOpen(false); }}>Export Text</button>
                  <button className="ns-export-item" onClick={() => { exportResults('csv'); setExportOpen(false); }}>Export CSV</button>
                </div>
              )}
            </div>
            <NewsButton
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              variant="secondary"
              aria-label="Toggle theme"
              icon={theme === 'dark' ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
            >
              Theme
            </NewsButton>
          </div>
        </div>
        <div className="ns-header-divider" />

        <div className="ns-command-subrow">
          <NewsButton variant="secondary" onClick={() => setShowFilters((s) => !s)} icon={<SlidersHorizontal size={15} />}>
            {showFilters ? 'Hide Filters' : 'Show Filters'}
            {activeCount > 0 && <span className="ns-filter-count">{activeCount}</span>}
          </NewsButton>
          <NewsButton variant="ghost" onClick={resetFilters}>Clear Filters</NewsButton>
        </div>
      </Card>

      {showFilters && (
        <Card className="ns-filter-panel">
          <div className="ns-filter-panel__head">
            <h3 className="m-0">Scanner Filters</h3>
            <span className="muted">Refine ticker universe, catalysts, and scoring thresholds.</span>
          </div>
          <TabbedFilterPanel filters={filters} setFilters={setFilters} />
        </Card>
      )}

      {error && (
        <Card className="ns-error-card">
          <div className="ns-error-text">
            <X size={16} /> Failed to load news: {error}
          </div>
        </Card>
      )}

      <div className={`ns-workspace ${panelState.open ? 'ns-workspace--split' : 'ns-workspace--single'}`}>
        <Card className="ns-feed-pane">
          {loading && news.length === 0 && (
            <div className="ns-state-empty">Loading catalyst news…</div>
          )}
          {!loading && sortedNews.length === 0 && (
            <div className="ns-state-empty">No news found. Adjust filters or refresh.</div>
          )}

          <div className="news-list ns-news-list">
            {sortedNews.map((item, idx) => {
              const tickers = parseTickers(item.Ticker || '');
              const primary = tickers[0] || 'N/A';
              const stock = stockMap[primary];
              const catalysts = detectCatalysts(item.Title || '');
              const score = item._score ?? computeStockScore(stock);
              const freshness = getTimeAgo(parseFinvizDate(item.Date || ''));
              const articleUrl = item.Url || item.URL || '#';
              const previewText = item.Summary || item.Description || `Catalyst signals: ${catalysts.join(', ')}.`;
              const impact = buildImpactAnalysis(item, stock, catalysts);
              const cardKey = `${articleUrl}-${idx}`;
              const change = Number((stock?.Change || '').replace('%', '')) || 0;
              const badges = buildBadges(catalysts, score, stock);
              const scoreBand = score >= 85 ? 'strong' : score >= 60 ? 'teal' : score >= 30 ? 'warn' : 'weak';
              const leadBadge = badges[0] || null;
              const selected = panelState.open && panelState.cardKey === cardKey;
              const tickerList = tickers.length ? tickers : [primary];
              const useWideTickerColumn = tickerList.length > 4;
              const leftColWidth = getLeftColumnWidth(tickerList.length);

              return (
                <article key={cardKey} className={`news-card ns-news-card ns-news-card--${scoreBand}${selected ? ' is-selected' : ''}`}>
                  <div
                    className="ns-card-grid"
                    style={{ gridTemplateColumns: `${leftColWidth} 1fr` }}
                  >
                    <div className={`ns-card-left ${useWideTickerColumn ? 'ns-card-left--two-col' : ''}`}>
                      {tickerList.map((ticker) => {
                        const tickerStock = stockMap[ticker];
                        const tickerScore = computeStockScore(tickerStock);
                        return renderTickerChip(ticker, tickerStock, tickerScore, catalysts, item, cardKey);
                      })}
                    </div>

                    <div className="ns-card-right">
                      <div className="ns-card-headline">{item.Title}</div>

                      <div className="ns-card-meta">
                        <span className="news-source">{item.Source || 'Finviz'}</span>
                        <span className="news-time">{freshness}</span>
                      </div>

                      <div className="ns-ticker-data-rail">
                        <span>Vol: {formatNumber(Number(stock?.Volume) || 0)}</span>
                        <span>RVOL: {stock?.['Rel Volume'] || stock?.['Relative Volume'] || '--'}</span>
                        <span>PDH/PDL: {stock?.['Day High'] || stock?.High || '--'} / {stock?.['Day Low'] || stock?.Low || '--'}</span>
                      </div>

                      {tickers.length > 1 && <div className="ns-card-preview">{previewText}</div>}

                      <div className="ns-card-badges">
                        {catalysts.map((c) => {
                          const insight = getCatalystInsight(c);
                          return (
                            <div key={c} className="ns-insight-anchor">
                              <span className={`catalyst-badge catalyst-${c}`}>{c}</span>
                              <div className="ns-insight-card">
                                <h5>{insight.title}</h5>
                                <p><strong>Definition:</strong> {insight.definition}</p>
                                <p><strong>Source origin:</strong> {insight.source}</p>
                                <p><strong>Market Behaviour:</strong> {insight.behaviour}</p>
                                <p><strong>What To Watch:</strong> {insight.watch}</p>
                                <p><strong>Risk Factors:</strong> {insight.risk}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="ns-card-actions">
                        <NewsButton
                          variant="secondary"
                          size="sm"
                          onClick={() => openPanel('behaviour', { ticker: primary, item, cardKey, score, catalysts, impact })}
                          icon={<BarChart3 size={16} />}
                        >
                          Market Behaviour
                        </NewsButton>
                        <NewsButton
                          variant="primary"
                          size="sm"
                          onClick={() => openPanel('details', { ticker: primary, item, cardKey, score, catalysts })}
                          icon={<Info size={16} />}
                        >
                          View Details
                        </NewsButton>
                        <NewsButton as="a" variant="secondary" size="sm" href={articleUrl} target="_blank" rel="noopener noreferrer" icon={<ExternalLink size={16} />}>
                          Open Original Article
                        </NewsButton>
                        <NewsButton
                          variant="secondary"
                          size="sm"
                          onClick={() => openPanel('catalyst', { ticker: primary, item, cardKey, score, catalysts, badge: leadBadge, impact })}
                          icon={<Info size={16} />}
                          disabled={!leadBadge}
                          className="ns-catalyst-action"
                        >
                          Catalyst Insight
                        </NewsButton>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </Card>

        <aside className={`ns-intel-pane ${panelState.open ? 'is-open' : ''}`}>
          <div className="ns-intel-pane__header">
            <h3>{panelTitle}</h3>
            <NewsButton variant="ghost" size="sm" iconOnly icon={<X size={15} />} onClick={closePanel} />
          </div>

          {panelState.open && (
            <div className="ns-intel-pane__body">
              {panelState.type === 'behaviour' && panelState.impact && (
                <>
                  <Card className="ns-intel-section">
                    <h4>Definition</h4>
                    <p>{panelState.impact.definition}</p>
                  </Card>
                  <Card className="ns-intel-section">
                    <h4>Typical Market Reaction</h4>
                    <p>{panelState.impact.reaction}</p>
                  </Card>
                  <Card className="ns-intel-section">
                    <h4>Sector Impact</h4>
                    <p>{panelState.impact.sector}</p>
                  </Card>
                  <Card className="ns-intel-section">
                    <h4>What to Watch</h4>
                    <ul>{panelState.impact.watch.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </Card>
                  <Card className="ns-intel-section">
                    <h4>Risk Factors</h4>
                    <ul>{panelState.impact.risk.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </Card>
                </>
              )}

              {panelState.type === 'details' && (
                <>
                  <Card className="ns-intel-section">
                    <h4>1D Chart</h4>
                    <TradingViewChart symbol={panelState.ticker} height={250} interval="5" range="1D" hideSideToolbar />
                  </Card>
                  <Card className="ns-intel-section">
                    <h4>15m Chart</h4>
                    <TradingViewChart symbol={panelState.ticker} height={250} interval="15" range="5D" hideSideToolbar />
                  </Card>
                  <Card className="ns-intel-section">
                    <h4>Key Metrics</h4>
                    <div className="ns-intel-metric-grid">
                      <div><span>Price</span><strong>{panelStock?.Price || '--'}</strong></div>
                      <div><span>% Change</span><strong>{panelStock?.Change || '--'}</strong></div>
                      <div><span>PDH/PDL</span><strong>{panelStock?.['Day High'] || panelStock?.High || '--'} / {panelStock?.['Day Low'] || panelStock?.Low || '--'}</strong></div>
                      <div><span>Float</span><strong>{panelStock?.['Shs Float'] || panelStock?.['Shares Float'] || '--'}</strong></div>
                      <div><span>RVOL</span><strong>{panelStock?.['Rel Volume'] || panelStock?.['Relative Volume'] || '--'}</strong></div>
                      <div><span>Volume</span><strong>{panelStock?.Volume ? formatNumber(Number(panelStock.Volume)) : '--'}</strong></div>
                      <div><span>ATR</span><strong>{panelStock?.ATR || panelStock?.['ATR (14)'] || '--'}</strong></div>
                      <div><span>Market Cap</span><strong>{panelStock?.['Market Cap'] || '--'}</strong></div>
                      <div><span>Earnings Date</span><strong>{panelStock?.['Earnings Date'] || '--'}</strong></div>
                      <div><span>Expected Move</span><strong>{(() => {
                        const price = Number(panelStock?.Price || 0);
                        const atr = Number(panelStock?.ATR || panelStock?.['ATR (14)'] || 0);
                        if (!price || !atr) return '--';
                        return `${((atr / price) * 100).toFixed(2)}%`;
                      })()}</strong></div>
                    </div>
                  </Card>
                  <Card className="ns-intel-section">
                    <h4>Recent Headlines</h4>
                    <div className="ns-intel-news-list">
                      {panelStories.slice(0, panelStoriesVisible).map((story, i) => {
                        const storyUrl = story.Url || story.URL || '#';
                        return (
                          <a key={`${storyUrl}-${i}`} href={storyUrl} target="_blank" rel="noopener noreferrer" className="ns-intel-story">
                            <div className="ns-intel-story-title">{story.Title}</div>
                            <div className="muted text-xs">{story.Source || 'Finviz'} · {getTimeAgo(parseFinvizDate(story.Date || ''))}</div>
                          </a>
                        );
                      })}
                    </div>
                    {panelStories.length > panelStoriesVisible && (
                      <NewsButton variant="secondary" size="sm" onClick={() => setPanelStoriesVisible((prev) => prev + 5)}>Load more</NewsButton>
                    )}
                  </Card>
                </>
              )}

              {panelState.type === 'catalyst' && (
                <>
                  <Card className="ns-intel-section">
                    <h4>{panelCatalystInsight.title}</h4>
                    <p>{panelCatalystInsight.definition}</p>
                    <p><strong>Source origin:</strong> {panelCatalystInsight.source}</p>
                  </Card>
                  <Card className="ns-intel-section">
                    <h4>Score Breakdown</h4>
                    <div className="ns-score-visual">
                      <div className="ns-score-total">
                        <span className="ns-score-total__label">Total Heuristic Score</span>
                        <strong>{panelScore.total.toFixed(1)} / 100</strong>
                        <span className={`ns-score-total__strength ns-score-total__strength--${panelScore.strength.toLowerCase()}`}>{panelScore.strength}</span>
                      </div>
                      <div className="ns-score-bars">
                        {panelScore.metrics.map((metric) => {
                          const percent = metric.max ? Math.max(0, Math.min(100, (metric.value / metric.max) * 100)) : 0;
                          return (
                            <div key={metric.label} className="ns-score-row">
                              <div className="ns-score-row__head">
                                <span>{metric.label}</span>
                                <span>{metric.value.toFixed(1)} / {metric.max}</span>
                              </div>
                              <div className="ns-score-row__track">
                                <div className={`ns-score-row__fill ns-score-row__fill--${getScoreTone(percent)}`} style={{ '--ns-fill': `${percent}%` }} />
                              </div>
                              <div className="muted text-xs">{metric.why}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </Card>
                  <Card className="ns-intel-section">
                    <h4>Confirmation Signals</h4>
                    <ul>{(panelState.impact?.watch || ['Sustained RVOL expansion and directional close above intraday value.']).map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </Card>
                  <Card className="ns-intel-section">
                    <h4>Invalidators</h4>
                    <ul>{(panelState.impact?.invalidators || ['Failure to hold VWAP after initial impulse.']).map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </Card>
                  <Card className="ns-intel-section">
                    <h4>Risk Factors</h4>
                    <ul>{(panelState.impact?.risk || [panelCatalystInsight.risk]).map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </Card>
                </>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
