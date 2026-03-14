import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react';
import StatusBadge from './StatusBadge';

function compareValues(a, b, type) {
  if (type === 'number' || type === 'progress') {
    return Number(a || 0) - Number(b || 0);
  }
  return String(a || '').localeCompare(String(b || ''));
}

function renderCell(column, row) {
  const value = typeof column.accessor === 'function' ? column.accessor(row) : row?.[column.accessor];

  if (column.type === 'status') {
    return <StatusBadge status={value} label={String(value || '').toUpperCase()} />;
  }

  if (column.type === 'badge') {
    return <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-200">{value}</span>;
  }

  if (column.type === 'progress') {
    const pct = Math.max(0, Math.min(100, Number(value || 0)));
    return (
      <div className="flex items-center gap-2">
        <div className="h-2 w-full max-w-28 rounded bg-slate-800">
          <div className="h-2 rounded bg-blue-400" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-slate-300">{pct.toFixed(0)}%</span>
      </div>
    );
  }

  if (column.type === 'number') {
    return <span className="tabular-nums">{Number(value || 0).toLocaleString()}</span>;
  }

  return <span>{value ?? '--'}</span>;
}

function AdminTable({ columns = [], rows = [], rowActions = null, rowKey = 'id' }) {
  const [sort, setSort] = useState({ key: null, direction: 'asc' });

  const sortedRows = useMemo(() => {
    if (!sort.key) return rows;
    const col = columns.find((column) => column.key === sort.key);
    if (!col) return rows;

    const copy = [...rows];
    copy.sort((a, b) => {
      const av = typeof col.accessor === 'function' ? col.accessor(a) : a?.[col.accessor];
      const bv = typeof col.accessor === 'function' ? col.accessor(b) : b?.[col.accessor];
      const result = compareValues(av, bv, col.type);
      return sort.direction === 'asc' ? result : -result;
    });

    return copy;
  }, [rows, columns, sort]);

  function onSort(column) {
    if (!column.sortable) return;
    setSort((prev) => {
      if (prev.key !== column.key) return { key: column.key, direction: 'asc' };
      return { key: column.key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
      <table className="min-w-full text-sm text-slate-100">
        <thead className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-400 ${column.align === 'right' ? 'text-right' : ''}`}
              >
                <button
                  type="button"
                  className={`inline-flex items-center gap-1 ${column.sortable ? 'hover:text-slate-200' : 'cursor-default'}`}
                  onClick={() => onSort(column)}
                  disabled={!column.sortable}
                >
                  <span>{column.label}</span>
                  {column.sortable && sort.key === column.key ? (
                    sort.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  ) : null}
                </button>
              </th>
            ))}
            {rowActions ? <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-400">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => (
            <tr
              key={row?.[rowKey] ?? `${index}`}
              className="border-t border-slate-800 transition hover:bg-slate-800/40"
            >
              {columns.map((column) => (
                <td
                  key={`${column.key}-${row?.[rowKey] ?? index}`}
                  className={`px-3 py-2 ${column.align === 'right' ? 'text-right' : ''}`}
                >
                  {renderCell(column, row)}
                </td>
              ))}
              {rowActions ? (
                <td className="px-3 py-2 text-right">
                  {typeof rowActions === 'function' ? rowActions(row) : (
                    <button
                      type="button"
                      className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"
                      aria-label="Row actions"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default memo(AdminTable);
