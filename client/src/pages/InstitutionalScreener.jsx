import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Save, Search } from 'lucide-react';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';
import Card from '../components/shared/Card';
import TradingViewChart from '../components/shared/TradingViewChart';
import { apiJSON } from '../config/api';
import FilterSidebar from '../components/screener/FilterSidebar';
import PresetSelector from '../components/screener/PresetSelector';
import ColumnSelector from '../components/screener/ColumnSelector';
import ScreenerTable, { defaultColumns } from '../components/screener/ScreenerTable';
import { buildQueryTreeFromRows, buildStructuredQueryTree, evaluateQueryTree } from '../utils/queryTree';

const SAVED_FILTERS_KEY = 'openrange:institutional-screener:saved-filters';
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 'All'];

const ADAPTIVE_FIELDS = [
  { key: 'price', label: 'Price' },
  { key: 'marketCap', label: 'Market Cap' },
  { key: 'float', label: 'Float' },
  { key: 'volume', label: 'Volume' },
  { key: 'relativeVolume', label: 'Relative Volume' },
  { key: 'dollarVolume', label: 'Dollar Volume' },
  { key: 'gapPercent', label: 'Gap %' },
  { key: 'changePercent', label: 'Change %' },
  { key: 'atrPct', label: 'ATR %' },
  { key: 'expectedMove', label: 'Expected Move' },
  { key: 'expectedMoveVsAtr', label: 'Expected Move vs ATR' },
  { key: 'priceVsVwap', label: 'Price vs VWAP' },
  { key: 'vwapDistance', label: 'VWAP Distance' },
  { key: 'rsi', label: 'RSI' },
  { key: 'priceVsSma20', label: 'Price vs SMA20' },
  { key: 'priceVsSma50', label: 'Price vs SMA50' },
  { key: 'priceVsSma200', label: 'Price vs SMA200' },
  { key: 'macdSignalDistance', label: 'MACD Signal Distance' },
  { key: 'dist52wHigh', label: '52W High Distance' },
  { key: 'dist52wLow', label: '52W Low Distance' },
  { key: 'shortFloat', label: 'Short Float' },
  { key: 'catalystScore', label: 'Catalyst Score' },
  { key: 'catalystType', label: 'Catalyst Type' },
  { key: 'newsSentiment', label: 'News Sentiment' },
  { key: 'strategyScore', label: 'Strategy Score' },
  { key: 'setupType', label: 'Setup Type' },
  { key: 'momentumScore', label: 'Momentum Score' },
  { key: 'volatilityExpansion', label: 'Volatility Expansion' },
  { key: 'sectorStrength', label: 'Sector Strength' },
  { key: 'marketRegimeAlignment', label: 'Market Regime Alignment' },
  { key: 'daysUntilEarnings', label: 'Days Until Earnings' },
  { key: 'earningsBeatRate', label: 'Earnings Beat Rate' },
  { key: 'volumeShock', label: 'Intraday Volume Surge' },
];

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

function buildSparkline(scanner, metrics, setup, catalyst) {
  const preferred =
    scanner.sparkline ||
    scanner.sparkline_1d ||
    metrics.sparkline ||
    metrics.sparkline_1d ||
    setup.sparkline ||
    catalyst.sparkline;

  if (Array.isArray(preferred) && preferred.length > 1) return preferred;

  const baseline = Number(scanner.price ?? metrics.price ?? 50) || 50;
  const drift = Number(metrics.change_percent ?? scanner.change_percent ?? scanner.gap_percent ?? 0) || 0;
  const scale = Math.max(0.2, Math.min(2.5, Math.abs(drift) / 6 + 0.35));

  return [
    baseline * (1 - 0.02 * scale),
    baseline * (1 - 0.01 * scale),
    baseline * (1 + 0.005 * scale),
    baseline * (1 + (drift / 100) * 0.4),
    baseline * (1 + (drift / 100) * 0.7),
    baseline * (1 + (drift / 100) * 0.9),
    baseline * (1 + drift / 100),
  ];
}

function rowFromSources(symbol, scannerMap, setupMap, catalystMap, metricsMap, expectedMoveMap, earningsMap, narrative) {
  const scanner = scannerMap.get(symbol) || {};
  const setup = setupMap.get(symbol) || {};
  const catalyst = catalystMap.get(symbol) || {};
  const metrics = metricsMap.get(symbol) || {};
  const expectedMove = expectedMoveMap.get(symbol) || {};
  const earnings = earningsMap.get(symbol) || {};

  const price = safeNumber(scanner.price ?? metrics.price);
  const atr = safeNumber(metrics.atr);
  const vwap = safeNumber(metrics.vwap);
  const expectedMoveValue = safeNumber(expectedMove.expected_move ?? expectedMove.expectedMove ?? expectedMove.move_percent);

  return {
    symbol,
    companyName: scanner.company_name || metrics.company_name || '--',
    exchange: scanner.exchange || metrics.exchange || '--',
    sector: scanner.sector || metrics.sector || '--',
    country: scanner.country || metrics.country || '--',
    price,
    changePercent: safeNumber(metrics.change_percent ?? scanner.change_percent ?? scanner.gap_percent),
    gapPercent: safeNumber(scanner.gap_percent ?? metrics.gap_percent),
    volume: safeNumber(metrics.volume ?? scanner.volume),
    relativeVolume: safeNumber(scanner.relative_volume ?? metrics.relative_volume),
    float: safeNumber(metrics.float ?? scanner.float ?? metrics.float_shares),
    atrPct: price && atr ? (atr / price) * 100 : null,
    vwapDistance: price && vwap ? ((price - vwap) / vwap) * 100 : null,
    rsi: safeNumber(metrics.rsi),
    strategyScore: safeNumber(setup.score),
    setupType: setup.setup || setup.setup_type || '--',
    catalystScore: safeNumber(catalyst.score ?? setup.catalyst_score),
    catalystType: catalyst.catalyst_type || setup.catalyst_type || '--',
    newsSentiment: catalyst.sentiment || setup.catalyst_sentiment || '--',
    expectedMove: expectedMoveValue,
    expectedMoveVsAtr: atr && expectedMoveValue ? expectedMoveValue / atr : null,
    dollarVolume: price && safeNumber(metrics.volume) ? price * Number(metrics.volume) : null,
    volumeShock: safeNumber(scanner.relative_volume ?? metrics.relative_volume),
    momentumScore: safeNumber(setup.score),
    volatilityExpansion: price && atr ? ((atr / price) * 100 > 3 ? 1 : 0) : 0,
    sectorStrength: safeNumber(metrics.sector_strength ?? 0),
    marketRegimeAlignment: narrative?.regime || 'Neutral',
    daysUntilEarnings: safeNumber(earnings.days_until ?? earnings.daysUntilEarnings),
    earningsDate: earnings.date || earnings.earnings_date || null,
    earningsBeatRate: safeNumber(earnings.beat_rate ?? earnings.beatRate),
    shortFloat: safeNumber(metrics.short_float ?? metrics.short_percent_float),
    marketCap: safeNumber(metrics.market_cap ?? scanner.market_cap),
    sparkline: buildSparkline(scanner, metrics, setup, catalyst),
  };
}

function createDefaultFilterRow() {
  return {
    id: crypto.randomUUID(),
    booleanOp: 'AND',
    field: 'price',
    operator: 'between',
    value: 3,
    valueTo: 50,
  };
}

function resolvePresetRows(preset) {
  switch (preset) {
    case 'top-gainers':
      return [{ ...createDefaultFilterRow(), field: 'changePercent', operator: '>', value: 4, valueTo: '' }];
    case 'top-losers':
      return [{ ...createDefaultFilterRow(), field: 'changePercent', operator: '<', value: -4, valueTo: '' }];
    case 'gap-up':
      return [{ ...createDefaultFilterRow(), field: 'gapPercent', operator: '>', value: 3, valueTo: '' }];
    case 'gap-down':
      return [{ ...createDefaultFilterRow(), field: 'gapPercent', operator: '<', value: -3, valueTo: '' }];
    case 'high-rvol':
      return [{ ...createDefaultFilterRow(), field: 'relativeVolume', operator: '>', value: 2.5, valueTo: '' }];
    case 'low-float-momentum':
      return [
        { ...createDefaultFilterRow(), field: 'float', operator: '<', value: 30000000, valueTo: '' },
        { ...createDefaultFilterRow(), booleanOp: 'AND', field: 'strategyScore', operator: '>', value: 75, valueTo: '' },
      ];
    case 'pre-market-movers':
      return [{ ...createDefaultFilterRow(), field: 'gapPercent', operator: '>', value: 2, valueTo: '' }];
    case 'post-earnings-movers':
      return [
        { ...createDefaultFilterRow(), field: 'daysUntilEarnings', operator: 'between', value: 0, valueTo: 3 },
        { ...createDefaultFilterRow(), booleanOp: 'AND', field: 'expectedMove', operator: '>', value: 2, valueTo: '' },
      ];
    case 'high-expected-move':
      return [{ ...createDefaultFilterRow(), field: 'expectedMove', operator: '>', value: 5, valueTo: '' }];
    case 'catalyst-technical':
      return [
        { ...createDefaultFilterRow(), field: 'catalystScore', operator: '>', value: 1.5, valueTo: '' },
        { ...createDefaultFilterRow(), booleanOp: 'AND', field: 'strategyScore', operator: '>', value: 70, valueTo: '' },
      ];
    default:
      return [createDefaultFilterRow()];
  }
}

export default function InstitutionalScreener() {
  const [loading, setLoading] = useState(true);
  const [tickerSearch, setTickerSearch] = useState('');
  const [preset, setPreset] = useState('none');
  const [filterMode, setFilterMode] = useState('adaptive');
  const [rawRows, setRawRows] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [adaptiveRows, setAdaptiveRows] = useState([createDefaultFilterRow()]);
  const [appliedAdaptiveRows, setAppliedAdaptiveRows] = useState([createDefaultFilterRow()]);
  const [structuredValues, setStructuredValues] = useState({
    exchange: '',
    sector: '',
    country: '',
    priceRange: '',
    marketCapRange: '',
    floatRange: '',
    rsiRange: '',
    vwapRelation: '',
    rvolRange: '',
    volumeShockRange: '',
    catalystType: '',
    sentiment: '',
    daysUntilEarnings: '',
    expectedMoveRange: '',
  });
  const [appliedStructuredValues, setAppliedStructuredValues] = useState(structuredValues);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState('strategyScore');
  const [sortDirection, setSortDirection] = useState('desc');
  const [filterRegistry, setFilterRegistry] = useState({});
  const [hiddenColumns, setHiddenColumns] = useState(new Set());
  const [columnOrder, setColumnOrder] = useState(defaultColumns.map((column) => column.key));
  const [heatmapMode, setHeatmapMode] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [systemReport, setSystemReport] = useState(null);

  const debouncedSearch = useDebouncedValue(tickerSearch, 250);

  const appliedQueryTree = useMemo(
    () => (filterMode === 'adaptive'
      ? buildQueryTreeFromRows(appliedAdaptiveRows)
      : buildStructuredQueryTree(appliedStructuredValues)),
    [filterMode, appliedAdaptiveRows, appliedStructuredValues]
  );

  const debouncedQuerySignature = useDebouncedValue(JSON.stringify(appliedQueryTree), 300);

  const columns = useMemo(() => {
    const map = new Map(defaultColumns.map((column) => [column.key, column]));
    return columnOrder.map((key) => map.get(key)).filter(Boolean);
  }, [columnOrder]);

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hiddenColumns.has(column.key)),
    [columns, hiddenColumns]
  );

  const loadData = useCallback(async () => {
    setLoading(true);

    const safe = async (path, fallback) => {
      try {
        return await apiJSON(path);
      } catch {
        return fallback;
      }
    };

    const [
      scanner,
      setups,
      catalysts,
      metrics,
      expectedMove,
      earnings,
      filters,
      system,
      narrative,
    ] = await Promise.all([
      safe('/api/scanner', []),
      safe('/api/setups', []),
      safe('/api/catalysts', []),
      safe('/api/metrics', []),
      safe('/api/expected-move', []),
      safe('/api/earnings', []),
      safe('/api/filters', {}),
      safe('/api/system/report', null),
      safe('/api/market-narrative', null),
    ]);

    const scannerMap = new Map((Array.isArray(scanner) ? scanner : []).map((row) => [String(row?.symbol || '').toUpperCase(), row]));
    const setupMap = new Map((Array.isArray(setups) ? setups : []).map((row) => [String(row?.symbol || '').toUpperCase(), row]));
    const catalystMap = new Map((Array.isArray(catalysts) ? catalysts : []).map((row) => [String(row?.symbol || '').toUpperCase(), row]));
    const metricsMap = new Map((Array.isArray(metrics) ? metrics : []).map((row) => [String(row?.symbol || '').toUpperCase(), row]));
    const expectedMoveMap = new Map((Array.isArray(expectedMove) ? expectedMove : []).map((row) => [String(row?.symbol || row?.ticker || '').toUpperCase(), row]));
    const earningsMap = new Map((Array.isArray(earnings) ? earnings : []).map((row) => [String(row?.symbol || row?.ticker || '').toUpperCase(), row]));

    const symbols = new Set([
      ...scannerMap.keys(),
      ...setupMap.keys(),
      ...catalystMap.keys(),
      ...metricsMap.keys(),
      ...expectedMoveMap.keys(),
    ]);

    const rows = [...symbols]
      .filter(Boolean)
      .map((symbol) => rowFromSources(symbol, scannerMap, setupMap, catalystMap, metricsMap, expectedMoveMap, earningsMap, narrative))
      .filter((row) => row.symbol);

    setRawRows(rows);
    setFilterRegistry(filters || {});
    setSystemReport(system);
    setLastRefresh(new Date().toISOString());
    setLoading(false);
    setSelectedSymbol((current) => current || rows[0]?.symbol || '');
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, debouncedQuerySignature]);

  useEffect(() => {
    if (preset === 'none') return;
    const rows = resolvePresetRows(preset);
    setAdaptiveRows(rows);
    setAppliedAdaptiveRows(rows);
  }, [preset]);

  const filteredRows = useMemo(() => {
    return rawRows
      .filter((row) => {
        if (!debouncedSearch) return true;
        const query = debouncedSearch.trim().toLowerCase();
        return row.symbol.toLowerCase().includes(query) || String(row.companyName || '').toLowerCase().includes(query);
      })
      .filter((row) => evaluateQueryTree(appliedQueryTree, row));
  }, [rawRows, debouncedSearch, appliedQueryTree]);

  const sortedRows = useMemo(() => {
    const next = [...filteredRows];
    next.sort((a, b) => {
      const left = a?.[sortKey];
      const right = b?.[sortKey];

      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;

      if (typeof left === 'number' && typeof right === 'number') {
        return sortDirection === 'asc' ? left - right : right - left;
      }

      const comparison = String(left).localeCompare(String(right));
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return next;
  }, [filteredRows, sortDirection, sortKey]);

  const total = sortedRows.length;
  const totalPages = pageSize === 'All' ? 1 : Math.max(1, Math.ceil(total / Number(pageSize)));
  const safePage = Math.min(page, totalPages);

  const pagedRows = useMemo(() => {
    if (pageSize === 'All') return sortedRows;
    const start = (safePage - 1) * Number(pageSize);
    return sortedRows.slice(start, start + Number(pageSize));
  }, [sortedRows, pageSize, safePage]);

  const selectedContext = useMemo(() => {
    return sortedRows.find((row) => row.symbol === selectedSymbol) || null;
  }, [sortedRows, selectedSymbol]);

  function updateAdaptiveRow(rowId, key, value) {
    setAdaptiveRows((current) => current.map((row) => (row.id === rowId ? { ...row, [key]: value } : row)));
  }

  function addAdaptiveRow() {
    setAdaptiveRows((current) => [...current, createDefaultFilterRow()]);
  }

  function removeAdaptiveRow(rowId) {
    setAdaptiveRows((current) => {
      const next = current.filter((row) => row.id !== rowId);
      return next.length ? next : [createDefaultFilterRow()];
    });
  }

  function exportCsv() {
    const headers = visibleColumns.map((column) => column.label);
    const lines = pagedRows.map((row) => visibleColumns.map((column) => {
      const value = column.render ? column.render(row) : row[column.key];
      return `"${String(value ?? '').replace(/"/g, '""')}"`;
    }).join(','));

    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openrange-screener-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function saveFilter() {
    const name = window.prompt('Save filter as:');
    if (!name) return;

    const saved = JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY) || '[]');
    const payload = {
      filter_name: name,
      preset,
      filterMode,
      adaptiveRows,
      structuredValues,
      query_tree: appliedQueryTree,
      timestamp: new Date().toISOString(),
      hiddenColumns: [...hiddenColumns],
      columnOrder,
    };

    const next = [...saved.filter((item) => (item.filter_name || item.name) !== name), payload];
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(next));
  }

  function loadFilter() {
    const saved = JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY) || '[]');
    if (!saved.length) {
      window.alert('No saved filters found.');
      return;
    }

    const selectedName = window.prompt(`Load filter name:\n${saved.map((item) => `• ${item.filter_name || item.name}`).join('\n')}`);
    if (!selectedName) return;

    const found = saved.find((item) => (item.filter_name || item.name) === selectedName);
    if (!found) {
      window.alert('Filter not found.');
      return;
    }

    setPreset(found.preset || 'none');
    setFilterMode(found.filterMode || 'adaptive');
    setAdaptiveRows(Array.isArray(found.adaptiveRows) && found.adaptiveRows.length ? found.adaptiveRows : [createDefaultFilterRow()]);
    setAppliedAdaptiveRows(Array.isArray(found.adaptiveRows) && found.adaptiveRows.length ? found.adaptiveRows : [createDefaultFilterRow()]);
    setStructuredValues(found.structuredValues || structuredValues);
    setAppliedStructuredValues(found.structuredValues || structuredValues);
    setHiddenColumns(new Set(found.hiddenColumns || []));
    setColumnOrder(Array.isArray(found.columnOrder) && found.columnOrder.length ? found.columnOrder : defaultColumns.map((column) => column.key));
  }

  function applyStructuredFilters() {
    setAppliedStructuredValues(structuredValues);
  }

  function clearStructuredFilters() {
    const empty = {
      exchange: '',
      sector: '',
      country: '',
      priceRange: '',
      marketCapRange: '',
      floatRange: '',
      rsiRange: '',
      vwapRelation: '',
      rvolRange: '',
      volumeShockRange: '',
      catalystType: '',
      sentiment: '',
      daysUntilEarnings: '',
      expectedMoveRange: '',
    };
    setStructuredValues(empty);
    setAppliedStructuredValues(empty);
  }

  function toggleColumn(columnKey) {
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (next.has(columnKey)) next.delete(columnKey);
      else next.add(columnKey);
      return next;
    });
  }

  function moveColumn(columnKey, direction) {
    setColumnOrder((current) => {
      const index = current.indexOf(columnKey);
      if (index === -1) return current;
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return copy;
    });
  }

  function setStructuredValue(key, value) {
    setStructuredValues((current) => ({ ...current, [key]: value }));
  }

  function handleSort(key) {
    setSortKey((current) => {
      if (current === key) {
        setSortDirection((dir) => (dir === 'asc' ? 'desc' : 'asc'));
        return current;
      }
      setSortDirection('desc');
      return key;
    });
  }

  function handleWatchlistAction(symbol) {
    const saved = JSON.parse(localStorage.getItem('openrange:quick-watchlist') || '[]');
    if (saved.includes(symbol)) return;
    localStorage.setItem('openrange:quick-watchlist', JSON.stringify([...saved, symbol]));
  }

  function openPathForSymbol(path, symbol) {
    window.location.assign(`${path}?symbol=${encodeURIComponent(symbol)}`);
  }

  const startIndex = total === 0 ? 0 : pageSize === 'All' ? 1 : (safePage - 1) * Number(pageSize) + 1;
  const endIndex = pageSize === 'All' ? total : Math.min(total, safePage * Number(pageSize));

  return (
    <PageContainer className="space-y-3">
      <PageHeader
        title="OpenRange Institutional Screener"
        subtitle="Adaptive query builder + structured institutional filters with live engine intelligence."
      />

      <Card className="rounded-2xl border border-[var(--border-color)] p-3 shadow-[0_8px_18px_rgba(10,14,20,0.12)]">
        <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-[var(--text-muted)]" size={16} />
            <input
              className="input-field h-10 w-full pl-9"
              value={tickerSearch}
              onChange={(event) => setTickerSearch(event.target.value)}
              placeholder="Search ticker or company"
            />
          </label>

          <PresetSelector value={preset} onChange={setPreset} />

          <button type="button" className="btn-secondary h-10 rounded-lg px-3 text-sm" onClick={saveFilter}><Save size={15} className="mr-1 inline" />Save Filter</button>
          <button type="button" className="btn-secondary h-10 rounded-lg px-3 text-sm" onClick={loadFilter}>Load Filter</button>
          <button type="button" className="btn-secondary h-10 rounded-lg px-3 text-sm" onClick={exportCsv}><Download size={15} className="mr-1 inline" />Export CSV</button>

          <div className="ml-auto flex items-center gap-2">
            <ColumnSelector
              columns={columns}
              hiddenColumns={hiddenColumns}
              onToggleColumn={toggleColumn}
              onMoveColumn={moveColumn}
            />
            <button
              type="button"
              className={`btn-secondary h-10 rounded-lg px-3 text-sm ${heatmapMode ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]' : ''}`}
              onClick={() => setHeatmapMode((current) => !current)}
            >
              Heatmap {heatmapMode ? 'On' : 'Off'}
            </button>
            <button type="button" className="btn-secondary h-10 rounded-lg px-3 text-sm" onClick={loadData}><RefreshCw size={15} className="mr-1 inline" />Refresh</button>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <FilterSidebar
          mode={filterMode}
          onModeChange={setFilterMode}
          adaptiveProps={{
            fields: ADAPTIVE_FIELDS,
            rows: adaptiveRows,
            onChangeRow: updateAdaptiveRow,
            onAddRow: addAdaptiveRow,
            onRemoveRow: removeAdaptiveRow,
            onApply: () => setAppliedAdaptiveRows(adaptiveRows),
            onClear: () => {
              const next = [createDefaultFilterRow()];
              setAdaptiveRows(next);
              setAppliedAdaptiveRows(next);
            },
          }}
          structuredProps={{
            values: structuredValues,
            onChange: setStructuredValue,
            onApply: applyStructuredFilters,
            onClear: clearStructuredFilters,
            filterRegistry,
          }}
        />

        <div className="space-y-3">
          {systemReport?.status === 'degraded' && (
            <Card className="rounded-xl border border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.08)] p-2.5 text-sm">
              Backend reported degraded status. Results may be partial.
            </Card>
          )}

          {loading ? (
            <Card className="space-y-2 p-3">
              <div className="h-5 w-44 animate-pulse rounded bg-[var(--bg-card-hover)]" />
              <div className="h-9 animate-pulse rounded bg-[var(--bg-card-hover)]" />
              <div className="h-9 animate-pulse rounded bg-[var(--bg-card-hover)]" />
              <div className="h-9 animate-pulse rounded bg-[var(--bg-card-hover)]" />
            </Card>
          ) : (
            <ScreenerTable
              rows={pagedRows}
              allColumns={columns}
              visibleColumns={visibleColumns}
              hiddenColumns={hiddenColumns}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={handleSort}
              onToggleColumn={toggleColumn}
              onSelectSymbol={setSelectedSymbol}
              selectedSymbol={selectedSymbol}
              heatmapMode={heatmapMode}
              onAddWatchlist={handleWatchlistAction}
              onOpenChart={(symbol) => openPathForSymbol('/charts', symbol)}
              onViewIntelligence={(symbol) => openPathForSymbol('/intelligence-inbox', symbol)}
              onViewCatalysts={(symbol) => openPathForSymbol('/open-market-radar', symbol)}
            />
          )}

          <Card className="flex flex-wrap items-center justify-between gap-2 rounded-xl p-2.5 text-sm">
            <div className="text-[var(--text-secondary)]">Showing {startIndex}–{endIndex} of {total} results</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {PAGE_SIZE_OPTIONS.map((option) => (
                <button
                  key={String(option)}
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-xs ${pageSize === option
                    ? 'bg-[rgba(74,158,255,0.2)] text-[var(--accent-blue)]'
                    : 'bg-[var(--bg-card-hover)] text-[var(--text-secondary)]'
                  }`}
                  onClick={() => {
                    setPageSize(option);
                    setPage(1);
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary h-8 rounded px-2 text-xs" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
              <span className="text-xs text-[var(--text-muted)]">Page {safePage} / {totalPages}</span>
              <button type="button" className="btn-secondary h-8 rounded px-2 text-xs" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
            </div>
          </Card>
        </div>

        <Card className="h-[calc(100vh-170px)] space-y-3 overflow-y-auto rounded-2xl p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Intelligence Panel</div>
          {!selectedContext ? (
            <div className="text-sm text-[var(--text-muted)]">Select a ticker row to inspect catalyst and strategy context.</div>
          ) : (
            <>
              <div>
                <div className="text-lg font-semibold">{selectedContext.symbol}</div>
                <div className="text-sm text-[var(--text-secondary)]">{selectedContext.companyName}</div>
              </div>

              <div className="rounded-xl border border-[var(--border-color)] p-2">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Mini Chart</div>
                <TradingViewChart symbol={selectedContext.symbol} interval="15" range="5D" height={210} hideSideToolbar />
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-[var(--border-color)] p-2">
                  <div className="text-xs text-[var(--text-muted)]">Strategy</div>
                  <div className="font-semibold">{selectedContext.setupType || '--'}</div>
                  <div className="text-xs text-[var(--text-secondary)]">Score: {selectedContext.strategyScore ?? '--'}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-color)] p-2">
                  <div className="text-xs text-[var(--text-muted)]">Catalyst</div>
                  <div className="font-semibold">{selectedContext.catalystType || '--'}</div>
                  <div className="text-xs text-[var(--text-secondary)]">Score: {selectedContext.catalystScore ?? '--'}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-color)] p-2">
                  <div className="text-xs text-[var(--text-muted)]">Expected Move</div>
                  <div className="font-semibold">{selectedContext.expectedMove ?? '--'}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-color)] p-2">
                  <div className="text-xs text-[var(--text-muted)]">Earnings Date</div>
                  <div className="font-semibold">{selectedContext.earningsDate || '--'}</div>
                </div>
              </div>
            </>
          )}

          <div className="text-xs text-[var(--text-muted)]">
            Last refresh: {lastRefresh ? new Date(lastRefresh).toLocaleTimeString() : '--'}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
