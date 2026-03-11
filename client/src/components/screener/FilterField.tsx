import type { FilterFieldSchema, FilterRangeValue, FilterValue } from './filterTypes';

type FilterFieldProps = {
  field: FilterFieldSchema;
  value: FilterValue | undefined;
  onSelectChange: (key: string, value: string) => void;
  onRangeChange: (key: string, range: Partial<FilterRangeValue>) => void;
};

function isRange(value: FilterValue | undefined): value is FilterRangeValue {
  return Boolean(value) && typeof value === 'object' && 'min' in (value as FilterRangeValue) && 'max' in (value as FilterRangeValue);
}

const baseInputClass =
  'w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none transition focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

export default function FilterField({ field, value, onSelectChange, onRangeChange }: FilterFieldProps) {
  if (field.type === 'select') {
    const selected = typeof value === 'string' ? value : '';
    return (
      <div className="space-y-1">
        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{field.label}</label>
        <select
          className={baseInputClass}
          value={selected}
          onChange={(event) => onSelectChange(field.key, event.target.value)}
        >
          {(field.options || [])?.map((option) => (
            <option key={option.value || 'any'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const range = isRange(value) ? value : { min: '', max: '' };

  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{field.label}</label>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          inputMode="decimal"
          className={baseInputClass}
          placeholder={field.placeholderMin || 'Min'}
          value={range.min}
          onChange={(event) => onRangeChange(field.key, { min: event.target.value })}
        />
        <input
          type="number"
          inputMode="decimal"
          className={baseInputClass}
          placeholder={field.placeholderMax || 'Max'}
          value={range.max}
          onChange={(event) => onRangeChange(field.key, { max: event.target.value })}
        />
      </div>
    </div>
  );
}
