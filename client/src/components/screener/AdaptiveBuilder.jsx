import { useMemo } from 'react';

function parseValue(raw) {
  if (raw == null || raw === '') return '';
  const asNum = Number(raw);
  return Number.isFinite(asNum) ? asNum : String(raw).trim();
}

const DEFAULT_OPERATORS = ['>', '>=', '<', '<=', 'between', 'equals', 'contains'];
const LOGIC_OPTIONS = ['AND', 'OR'];

export default function AdaptiveBuilder({ fields = [], rows = [], onChangeRow, onAddRow, onRemoveRow, onApply, onClear }) {
  const operatorMap = useMemo(
    () => new Map((fields || []).map((field) => [field.key, field.operators || []])),
    [fields]
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((row, index) => {
          const availableOperators = operatorMap.get(row.field)?.length
            ? operatorMap.get(row.field)
            : DEFAULT_OPERATORS;

          return (
            <div key={row.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-2.5">
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[84px_1fr_126px_1fr_1fr_36px]">
                <select
                  className="input-field h-9"
                  value={row.logic || 'AND'}
                  onChange={(event) => onChangeRow(row.id, 'logic', event.target.value)}
                  disabled={index === 0}
                >
                  {LOGIC_OPTIONS.map((logic) => (
                    <option key={logic} value={logic}>{logic}</option>
                  ))}
                </select>

                <select
                  className="input-field h-9"
                  value={row.field}
                  onChange={(event) => onChangeRow(row.id, 'field', event.target.value)}
                >
                  {(fields || []).map((field) => (
                    <option key={field.key} value={field.key}>{field.label}</option>
                  ))}
                </select>

                <select
                  className="input-field h-9"
                  value={row.operator}
                  onChange={(event) => onChangeRow(row.id, 'operator', event.target.value)}
                >
                  {availableOperators.map((operator) => (
                    <option key={operator} value={operator}>{operator}</option>
                  ))}
                </select>

                <input
                  className="input-field h-9"
                  placeholder="Value"
                  value={row.value}
                  onChange={(event) => onChangeRow(row.id, 'value', parseValue(event.target.value))}
                />

                <input
                  className="input-field h-9"
                  placeholder={row.operator === 'between' ? 'Max value' : 'Optional'}
                  value={row.valueTo ?? ''}
                  disabled={row.operator !== 'between'}
                  onChange={(event) => onChangeRow(row.id, 'valueTo', parseValue(event.target.value))}
                />

                <button
                  type="button"
                  className="rounded-md border border-[var(--border-color)] text-sm text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]"
                  onClick={() => onRemoveRow(row.id)}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={onAddRow}>Add Filter</button>
        <button type="button" className="btn-primary rounded-lg px-3 py-2 text-sm" onClick={onApply}>Apply Filters</button>
        <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={onClear}>Clear Filters</button>
      </div>
    </div>
  );
}
