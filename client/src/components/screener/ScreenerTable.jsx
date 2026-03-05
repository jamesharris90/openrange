import { memo, useMemo, useState } from 'react';

const ROW_HEIGHT = 42;
const BODY_HEIGHT = 520;

function fmt(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return number.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

const TableRow = memo(function TableRow({ row, visibleColumns, onSelect, selected }) {
  return (
    <tr
      className={`cursor-pointer transition-colors ${selected ? 'bg-[rgba(74,158,255,0.14)]' : 'hover:bg-[rgba(74,158,255,0.08)]'}`}
      style={{ height: ROW_HEIGHT }}
      onClick={() => onSelect(row.symbol)}
    >
      {visibleColumns.map((column) => {
        const rendered = column.render ? column.render(row) : row[column.key];
        return (
          <td key={column.key} style={{ textAlign: column.align || 'left' }}>
            {column.key === 'symbol' ? <strong>{rendered || '--'}</strong> : rendered ?? '--'}
          </td>
        );
      })}
    </tr>
  );
});

export default function ScreenerTable({
  rows,
  visibleColumns,
  sortKey,
  sortDirection,
  onSort,
  onSelectSymbol,
  selectedSymbol,
}) {
  const useVirtualization = rows.length > 100;
  const [scrollTop, setScrollTop] = useState(0);

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

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-[0_8px_20px_rgba(12,14,18,0.12)]">
      <div className="max-h-[560px] overflow-auto" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <table className="data-table min-w-[1120px]">
          <thead>
            <tr>
              {visibleColumns.map((column) => {
                const active = sortKey === column.key;
                const arrow = !active ? '↕' : sortDirection === 'asc' ? '↑' : '↓';
                return (
                  <th
                    key={column.key}
                    style={{ textAlign: column.align || 'left', whiteSpace: 'nowrap' }}
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 bg-transparent p-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                      onClick={() => onSort(column.key)}
                    >
                      {column.label} <span>{arrow}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 && (
              <tr>
                <td colSpan={visibleColumns.length} style={{ height: topSpacerHeight, padding: 0, border: 'none' }} />
              </tr>
            )}

            {slice.map((row) => (
              <TableRow
                key={`${row.symbol}-${row.strategyScore ?? ''}-${row.catalystScore ?? ''}`}
                row={row}
                visibleColumns={visibleColumns}
                onSelect={onSelectSymbol}
                selected={selectedSymbol === row.symbol}
              />
            ))}

            {bottomSpacerHeight > 0 && (
              <tr>
                <td colSpan={visibleColumns.length} style={{ height: bottomSpacerHeight, padding: 0, border: 'none' }} />
              </tr>
            )}

            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="py-8 text-center text-sm text-[var(--text-muted)]">
                  No results match the current filter criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-[var(--border-color)] px-3 py-2 text-xs text-[var(--text-muted)]">
        Hover rows for quick scan. Click ticker row to open intelligence context.
      </div>
    </div>
  );
}

export const defaultColumns = [
  { key: 'symbol', label: 'Ticker' },
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
