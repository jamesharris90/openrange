import { useMemo, useState } from 'react';

const DEFAULT_TABS = ['Descriptive', 'Fundamental', 'Technical', 'Volume', 'Catalyst', 'Earnings', 'All'];

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <select className="input-field h-9 w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

const numberRangeOptions = [
  { value: '0-2', label: '0 - 2' },
  { value: '2-5', label: '2 - 5' },
  { value: '5-10', label: '5 - 10' },
  { value: '10-25', label: '10 - 25' },
  { value: '25-50', label: '25 - 50' },
  { value: '50-200', label: '50 - 200' },
  { value: '200-999999', label: '200+' },
];

export default function StructuredFilters({ values, onChange, onApply, onClear, filterRegistry }) {
  const [activeTab, setActiveTab] = useState('Descriptive');

  const filters = useMemo(() => Array.isArray(filterRegistry?.filters) ? filterRegistry.filters : [], [filterRegistry]);
  const tabs = useMemo(() => filterRegistry?.structured_tabs || DEFAULT_TABS, [filterRegistry]);

  const visibleFilters = useMemo(() => {
    if (activeTab === 'All') return filters;
    return filters.filter((filter) => filter.group === activeTab);
  }, [activeTab, filters]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-semibold ${activeTab === tab
              ? 'bg-[rgba(74,158,255,0.2)] text-[var(--accent-blue)]'
              : 'bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {visibleFilters.map((filter) => {
          if (filter.type === 'number') {
            return (
              <SelectField
                key={filter.field}
                label={filter.label}
                value={values[filter.field] || ''}
                options={numberRangeOptions}
                onChange={(value) => onChange(filter.field, value)}
              />
            );
          }

          if (filter.type === 'date') {
            return (
              <label key={filter.field} className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{filter.label}</div>
                <input
                  className="input-field h-9 w-full"
                  placeholder="YYYY-MM-DD|YYYY-MM-DD"
                  value={values[filter.field] || ''}
                  onChange={(event) => onChange(filter.field, event.target.value)}
                />
              </label>
            );
          }

          return (
            <label key={filter.field} className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{filter.label}</div>
              <input
                className="input-field h-9 w-full"
                placeholder="Contains..."
                value={values[filter.field] || ''}
                onChange={(event) => onChange(filter.field, event.target.value)}
              />
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary rounded-lg px-3 py-2 text-sm" onClick={onApply}>Apply Filters</button>
        <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-sm" onClick={onClear}>Clear</button>
      </div>
    </div>
  );
}
