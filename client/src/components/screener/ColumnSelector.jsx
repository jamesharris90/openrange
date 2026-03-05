import { useMemo, useState } from 'react';

export default function ColumnSelector({ columns, hiddenColumns, onToggleColumn, onMoveColumn }) {
  const [open, setOpen] = useState(false);
  const columnList = useMemo(() => columns, [columns]);

  return (
    <div className="relative">
      <button
        type="button"
        className="btn-secondary h-10 rounded-lg px-3 text-sm"
        onClick={() => setOpen((current) => !current)}
      >
        Columns
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-30 w-72 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 shadow-[0_18px_30px_rgba(0,0,0,0.18)]">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Customize Columns</div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {columnList.map((column, index) => {
              const checked = !hiddenColumns.has(column.key);
              return (
                <div
                  key={column.key}
                  className="flex items-center justify-between rounded-lg border border-[var(--border-color)] px-2 py-1.5"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleColumn(column.key)}
                    />
                    <span>{column.label}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded border border-[var(--border-color)] px-1.5 text-xs"
                      disabled={index === 0}
                      onClick={() => onMoveColumn(column.key, 'up')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="rounded border border-[var(--border-color)] px-1.5 text-xs"
                      disabled={index === columnList.length - 1}
                      onClick={() => onMoveColumn(column.key, 'down')}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
