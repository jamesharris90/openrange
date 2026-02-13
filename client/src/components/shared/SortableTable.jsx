import { useState, useMemo, memo } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

const TableRow = memo(function TableRow({ row, columns, rowKey, onRowClick, rowClassName }) {
  return (
    <tr
      key={rowKey(row)}
      onClick={onRowClick ? () => onRowClick(row) : undefined}
      className={rowClassName?.(row) || ''}
      style={onRowClick ? { cursor: 'pointer' } : undefined}
    >
      {columns.map(col => (
        <td key={col.key} style={{ textAlign: col.align || 'left' }}>
          {col.render ? col.render(row) : row[col.key]}
        </td>
      ))}
    </tr>
  );
});

export default function SortableTable({ columns, data, rowKey, onRowClick, rowClassName, virtualizeThreshold = Infinity, rowHeight = 44, maxHeight = 640 }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [scrollTop, setScrollTop] = useState(0);

  const sorted = useMemo(() => {
    if (!sortCol) return data;
    const col = columns.find(c => c.key === sortCol);
    if (!col) return data;
    const getValue = col.sortValue || (row => row[sortCol]);
    return [...data].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [data, sortCol, sortDir, columns]);

  const virtualize = sorted.length > virtualizeThreshold;
  const startIndex = virtualize ? Math.max(0, Math.floor(scrollTop / rowHeight)) : 0;
  const visibleCount = virtualize ? Math.ceil(maxHeight / rowHeight) + 5 : sorted.length;
  const endIndex = virtualize ? Math.min(sorted.length, startIndex + visibleCount) : sorted.length;
  const rendered = virtualize ? sorted.slice(startIndex, endIndex) : sorted;

  const topPad = virtualize ? startIndex * rowHeight : 0;
  const bottomPad = virtualize ? Math.max(0, (sorted.length - endIndex) * rowHeight) : 0;

  const handleSort = (key) => {
    if (sortCol === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(key);
      setSortDir('asc');
    }
  };

  return (
    <div
      className="table-wrapper"
      style={virtualize ? { maxHeight, overflow: 'auto' } : undefined}
      onScroll={virtualize ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
    >
      <table className="data-table">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
                style={{ cursor: col.sortable !== false ? 'pointer' : 'default', textAlign: col.align || 'left' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {col.label}
                  {sortCol === col.key && (
                    sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={columns.length} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No data</td></tr>
          ) : (
            <>
              {virtualize && topPad > 0 && (
                <tr><td style={{ height: topPad }} colSpan={columns.length} aria-hidden="true" /></tr>
              )}
              {rendered.map(row => (
                <TableRow
                  key={rowKey(row)}
                  row={row}
                  columns={columns}
                  rowKey={rowKey}
                  onRowClick={onRowClick}
                  rowClassName={rowClassName}
                />
              ))}
              {virtualize && bottomPad > 0 && (
                <tr><td style={{ height: bottomPad }} colSpan={columns.length} aria-hidden="true" /></tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
