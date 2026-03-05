import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, LineChart, Newspaper, Star } from 'lucide-react';
import SparklineMini from '../charts/SparklineMini';
import MetricBar from '../ui/MetricBar';

const ROW_HEIGHT = 42;
const BODY_HEIGHT = 520;
const NEW_ROW_HIGHLIGHT_MS = 1800;

function fmt(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return number.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function heatColor(key, value, enabled) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  const baseIntensity = enabled ? 0.5 : 0.22;

  if (key === 'changePercent' || key === 'gapPercent') {
    const strength = Math.min(1, Math.abs(number) / 10);
    const alpha = baseIntensity * strength;
    return number >= 0
      ? `rgba(34, 197, 94, ${alpha})`
      : `rgba(239, 68, 68, ${alpha})`;
  }

  if (key === 'relativeVolume') {
    const strength = Math.min(1, Math.max(0, (number - 1) / 3));
    return `rgba(56, 189, 248, ${baseIntensity * strength})`;
  }

  if (key === 'strategyScore' || key === 'catalystScore') {
    const clamped = Math.max(0, Math.min(100, number));
    const strength = clamped / 100;
    return `rgba(34, 197, 94, ${baseIntensity * strength})`;
  }

  if (!enabled) return null;
  const genericStrength = Math.min(1, Math.abs(number) / 100);
  return `rgba(74, 158, 255, ${0.15 * genericStrength})`;
}

const TableRow = memo(function TableRow({
  row,
  visibleColumns,
  onSelect,
  selected,
  isNew,
  heatmapMode,
  onAddWatchlist,
  onOpenChart,
  onViewIntelligence,
  onViewCatalysts,
}) {
  return (
    <tr
      className={`group cursor-pointer transition-colors ${selected ? 'bg-[rgba(74,158,255,0.14)]' : 'hover:bg-[rgba(74,158,255,0.08)]'}`}
      style={{
        height: ROW_HEIGHT,
        backgroundColor: isNew ? 'rgba(56, 189, 248, 0.14)' : undefined,
        transition: 'background-color 900ms ease',
      }}
      onClick={() => onSelect(row.symbol)}
    >
      {visibleColumns.map((column) => {
        const rendered = column.render ? column.render(row) : row[column.key];
        const cellHeat = heatColor(column.key, row[column.key], heatmapMode);
        const isMetricBar = ['gapPercent', 'changePercent', 'relativeVolume', 'strategyScore', 'catalystScore'].includes(column.key);
        const metricColor = (column.key === 'gapPercent' || column.key === 'changePercent')
          ? (Number(row[column.key]) >= 0 ? 'green' : 'red')
          : (column.key === 'relativeVolume' ? 'blue' : 'green');
        const metricMax = column.key === 'relativeVolume' ? 5 : (column.key === 'strategyScore' || column.key === 'catalystScore' ? 100 : 10);
        const metricDigits = column.key === 'strategyScore' || column.key === 'catalystScore' ? 1 : 2;
        const metricSuffix = (column.key === 'gapPercent' || column.key === 'changePercent') ? '%' : '';

        return (
          <td key={column.key} style={{ textAlign: column.align || 'left', background: cellHeat || undefined }}>
            {column.key === 'symbol' ? (
              <div className="flex items-center gap-2">
                <strong>{rendered || '--'}</strong>
                <SparklineMini points={row.sparkline} positive={(row.changePercent ?? 0) >= 0} />
              </div>
            ) : column.key === 'sectorStrength' ? (
              <div className="flex items-center gap-2">
                <span className="truncate">{row.sector || '--'}</span>
                <MetricBar value={row.sectorStrength} maxValue={10} colorScheme="blue" suffix="%" digits={1} />
              </div>
            ) : isMetricBar ? (
              <MetricBar
                value={row[column.key]}
                maxValue={metricMax}
                colorScheme={metricColor}
                suffix={metricSuffix}
                digits={metricDigits}
              />
            ) : rendered ?? '--'}
          </td>
        );
      })}

      <td className="sticky right-0 bg-[var(--bg-card)] py-0 pr-2 text-right" onClick={(event) => event.stopPropagation()}>
        <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" className="rounded border border-[var(--border-color)] p-1 hover:bg-[var(--bg-card-hover)]" title="Add to Watchlist" onClick={() => onAddWatchlist(row.symbol)}><Star size={13} /></button>
          <button type="button" className="rounded border border-[var(--border-color)] p-1 hover:bg-[var(--bg-card-hover)]" title="Open Chart" onClick={() => onOpenChart(row.symbol)}><LineChart size={13} /></button>
          <button type="button" className="rounded border border-[var(--border-color)] p-1 hover:bg-[var(--bg-card-hover)]" title="View Intelligence" onClick={() => onViewIntelligence(row.symbol)}><BarChart3 size={13} /></button>
          <button type="button" className="rounded border border-[var(--border-color)] p-1 hover:bg-[var(--bg-card-hover)]" title="View Catalysts" onClick={() => onViewCatalysts(row.symbol)}><Newspaper size={13} /></button>
        </div>
      </td>
    </tr>
  );
});

export default function ScreenerTable({
  rows,
  allColumns,
  visibleColumns,
  hiddenColumns,
  sortKey,
  sortDirection,
  onSort,
  onToggleColumn,
  onSelectSymbol,
  selectedSymbol,
  heatmapMode,
  onAddWatchlist,
  onOpenChart,
  onViewIntelligence,
  onViewCatalysts,
}) {
  const useVirtualization = rows.length > 100;
  const [scrollTop, setScrollTop] = useState(0);
  const [showColumns, setShowColumns] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [columnWidths, setColumnWidths] = useState({});
  const [newSymbols, setNewSymbols] = useState(new Set());
  const resizeRef = useRef({ key: null, startX: 0, startWidth: 0 });
  const previousRowsRef = useRef([]);

  const { slice, topSpacerHeight, bottomSpacerHeight } = useMemo(() => {
    if (!useVirtualization) {
      return {
        slice: rows,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const visibleCount = Math.ceil(BODY_HEIGHT / ROW_HEIGHT) + 8;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
    const end = Math.min(rows.length, start + visibleCount);

    return {
      slice: rows.slice(start, end),
      topSpacerHeight: start * ROW_HEIGHT,
      bottomSpacerHeight: Math.max(0, (rows.length - end) * ROW_HEIGHT),
    };
  }, [rows, scrollTop, useVirtualization]);

  useEffect(() => {
    const previousSet = new Set(previousRowsRef.current.map((row) => row.symbol));
    const incoming = rows.filter((row) => row?.symbol && !previousSet.has(row.symbol)).map((row) => row.symbol);

    if (!incoming.length) {
      previousRowsRef.current = rows;
      return;
    }

    setNewSymbols(new Set(incoming));
    previousRowsRef.current = rows;

    const timer = setTimeout(() => setNewSymbols(new Set()), NEW_ROW_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [rows]);

  function applyColumnResize(event) {
    const active = resizeRef.current;
    if (!active.key) return;
    const nextWidth = Math.max(90, active.startWidth + (event.clientX - active.startX));
    setColumnWidths((current) => ({ ...current, [active.key]: nextWidth }));
  }

  function stopColumnResize() {
    resizeRef.current = { key: null, startX: 0, startWidth: 0 };
    window.removeEventListener('mousemove', applyColumnResize);
    window.removeEventListener('mouseup', stopColumnResize);
  }

  function startColumnResize(event, key) {
    resizeRef.current = {
      key,
      startX: event.clientX,
      startWidth: columnWidths[key] || 140,
    };
    window.addEventListener('mousemove', applyColumnResize);
    window.addEventListener('mouseup', stopColumnResize);
  }

  function onTableKeyDown(event) {
    if (!rows.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusedIndex((current) => {
        const next = Math.min(rows.length - 1, current + 1);
        onSelectSymbol(rows[next].symbol);
        return next;
      });
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedIndex((current) => {
        const next = Math.max(0, current - 1);
        onSelectSymbol(rows[next].symbol);
        return next;
      });
    }
    if (event.key === 'Enter' && rows[focusedIndex]) {
      onSelectSymbol(rows[focusedIndex].symbol);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-[0_8px_20px_rgba(12,14,18,0.12)]">
      <div className="flex items-center justify-between border-b border-[var(--border-color)] px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Institutional Results</div>
        <div className="relative">
          <button type="button" className="rounded border border-[var(--border-color)] px-2 py-1 text-xs" onClick={() => setShowColumns((current) => !current)}>Columns</button>
          {showColumns && (
            <div className="absolute right-0 top-8 z-20 w-56 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-2 shadow-[0_12px_24px_rgba(0,0,0,0.18)]">
              {allColumns.map((column) => (
                <label key={column.key} className="flex items-center gap-2 py-1 text-xs">
                  <input type="checkbox" checked={!hiddenColumns.has(column.key)} onChange={() => onToggleColumn(column.key)} />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div tabIndex={0} className="max-h-[560px] overflow-auto outline-none" onKeyDown={onTableKeyDown} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <table className="data-table min-w-[1120px]">
          <thead>
            <tr>
              {visibleColumns.map((column) => {
                const active = sortKey === column.key;
                const arrow = !active ? '↕' : sortDirection === 'asc' ? '↑' : '↓';
                const width = columnWidths[column.key] || (column.key === 'symbol' ? 180 : 140);
                return (
                  <th
                    key={column.key}
                    className="sticky top-0 z-10 bg-[var(--bg-card)]"
                    style={{ textAlign: column.align || 'left', whiteSpace: 'nowrap', width, minWidth: width }}
                  >
                    <div className="relative flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 bg-transparent p-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                        onClick={() => onSort(column.key)}
                      >
                        {column.label} <span>{arrow}</span>
                      </button>
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
                        onMouseDown={(event) => startColumnResize(event, column.key)}
                      />
                    </div>
                  </th>
                );
              })}
              <th className="sticky right-0 top-0 z-20 w-[120px] bg-[var(--bg-card)] text-right text-xs uppercase tracking-wide text-[var(--text-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1} style={{ height: topSpacerHeight, padding: 0, border: 'none' }} />
              </tr>
            )}

            {slice.map((row) => (
              <TableRow
                key={`${row.symbol}-${row.strategyScore ?? ''}-${row.catalystScore ?? ''}`}
                row={row}
                visibleColumns={visibleColumns}
                onSelect={onSelectSymbol}
                selected={selectedSymbol === row.symbol}
                isNew={newSymbols.has(row.symbol)}
                heatmapMode={heatmapMode}
                onAddWatchlist={onAddWatchlist}
                onOpenChart={onOpenChart}
                onViewIntelligence={onViewIntelligence}
                onViewCatalysts={onViewCatalysts}
              />
            ))}

            {bottomSpacerHeight > 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1} style={{ height: bottomSpacerHeight, padding: 0, border: 'none' }} />
              </tr>
            )}

            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="py-8 text-center text-sm text-[var(--text-muted)]">
                  No results match the current filter criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-muted)]">
        Hover rows for quick actions. Use keyboard arrows to navigate rows.
      </div>
    </div>
  );
}

export const defaultColumns = [
  { key: 'symbol', label: 'Ticker', align: 'left' },
  { key: 'sectorStrength', label: 'Sector Strength', align: 'left' },
  { key: 'price', label: 'Price', align: 'right', render: (row) => fmt(row.price, 2) },
  { key: 'changePercent', label: 'Change %', align: 'right', render: (row) => fmt(row.changePercent, 2) },
  { key: 'gapPercent', label: 'Gap %', align: 'right', render: (row) => fmt(row.gapPercent, 2) },
  { key: 'volume', label: 'Volume', align: 'right', render: (row) => fmt(row.volume, 0) },
  { key: 'relativeVolume', label: 'Relative Volume', align: 'right', render: (row) => fmt(row.relativeVolume, 2) },
  { key: 'float', label: 'Float', align: 'right', render: (row) => fmt(row.float, 0) },
  { key: 'atrPct', label: 'ATR %', align: 'right', render: (row) => fmt(row.atrPct, 2) },
  { key: 'vwapDistance', label: 'VWAP Distance', align: 'right', render: (row) => fmt(row.vwapDistance, 2) },
  { key: 'rsi', label: 'RSI', align: 'right', render: (row) => fmt(row.rsi, 2) },
  { key: 'strategyScore', label: 'Strategy Score', align: 'right', render: (row) => fmt(row.strategyScore, 1) },
  { key: 'catalystScore', label: 'Catalyst Score', align: 'right', render: (row) => fmt(row.catalystScore, 1) },
];
