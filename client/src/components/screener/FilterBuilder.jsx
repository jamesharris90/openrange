import { useMemo } from 'react';

function parseValue(raw) {
  if (raw == null || raw === '') return null;
  const asNum = Number(raw);
  return Number.isFinite(asNum) ? asNum : String(raw).trim();
}

const DEFAULT_OPERATORS = [
  { key: '>', label: '>' },
  { key: '>=', label: '>=' },
  { key: '<', label: '<' },
  { key: '<=', label: '<=' },
  { key: 'between', label: 'between' },
  { key: 'equals', label: '=' },
  { key: 'contains', label: 'contains' },
];

const BOOL_OPERATORS = [
  { key: 'AND', label: 'AND' },
  { key: 'OR', label: 'OR' },
  { key: 'NOT', label: 'NOT' },
];

export default function FilterBuilder({ fields, rows, onChangeRow, onAddRow, onRemoveRow, onApply, onClear }) {
  const fieldOptions = useMemo(() => fields, [fields]);
  const operatorMap = useMemo(
    () => new Map(fieldOptions.map((field) => [field.key, field.operators || []])),
    [fieldOptions]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {rows.map((row, index) => (
          <span key={row.id} className="rounded-full bg-[rgba(74,158,255,0.16)] px-3 py-1 text-xs text-[var(--text-secondary)]">
            {index > 0 ? `${row.booleanOp} ` : ''}
            {row.field} {row.operator} {row.value || '--'}
            {row.operator === 'between' ? ` to ${row.valueTo || '--'}` : ''}
          </span>
        ))}
      </div>

      <div className="space-y-2 transition-all duration-300">
        {rows.map((row, index) => (
          <div key={row.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-2.5">
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-[80px_1fr_130px_1fr_1fr_36px]">
              <select
                className="input-field h-9"
                value={row.booleanOp}
                onChange={(event) => onChangeRow(row.id, 'booleanOp', event.target.value)}
                disabled={index === 0}
              >
                {BOOL_OPERATORS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>

              <select
                className="input-field h-9"
                value={row.field}
                onChange={(event) => onChangeRow(row.id, 'field', event.target.value)}
              >
                {fieldOptions.map((field) => (
                  <option key={field.key} value={field.key}>{field.label}</option>
                ))}
              </select>

              <select
                className="input-field h-9"
                value={row.operator}
                onChange={(event) => onChangeRow(row.id, 'operator', event.target.value)}
              >
                  {(operatorMap.get(row.field)?.length
                    ? operatorMap.get(row.field).map((item) => ({ key: item, label: item }))
                    : DEFAULT_OPERATORS
                  ).map((operator) => (
                    <option key={operator.key} value={operator.key}>{operator.label}</option>
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
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={onAddRow}>Add Filter</button>
        <button type="button" className="btn-primary rounded-lg px-3 py-2 text-sm" onClick={onApply}>Apply Filters</button>
        <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={onClear}>Clear Filters</button>
      </div>
    </div>
  );
}
