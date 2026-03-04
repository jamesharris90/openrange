import { useMemo, useState } from 'react';
import AdvancedFilterTabs from './AdvancedFilterTabs';
import FilterField from './FilterField';
import { adaptiveFilterSchema, filterSchema, filterTabs } from './filterSchema';
import { useAdvancedFilterStore } from '../../store/advancedFilterStore';
import { useShallow } from 'zustand/react/shallow';

function getActiveFilterCount(values: Record<string, unknown>) {
  return Object.values(values).reduce<number>((count, value) => {
    if (typeof value === 'string') {
      return value ? count + 1 : count;
    }

    if (value && typeof value === 'object' && 'min' in (value as Record<string, unknown>) && 'max' in (value as Record<string, unknown>)) {
      const rangeValue = value as { min?: string; max?: string };
      return rangeValue.min || rangeValue.max ? count + 1 : count;
    }

    return count;
  }, 0);
}

type FilterSectionProps = {
  onApply: () => void;
  onReset: () => void;
};

export default function FilterSection({ onApply, onReset }: FilterSectionProps) {
  const [filterMode, setFilterMode] = useState<'standard' | 'adaptive'>('standard');

  const {
    activeTab,
    collapsed,
    filterValues,
    presets,
    setActiveTab,
    setFilterValue,
    setRangeValue,
    applyFilters,
    resetFilters,
    toggleCollapsed,
    savePreset,
    loadPreset,
    deletePreset,
  } = useAdvancedFilterStore(
    useShallow((state) => ({
      activeTab: state.activeTab,
      collapsed: state.collapsed,
      filterValues: state.filterValues,
      presets: state.presets,
      setActiveTab: state.setActiveTab,
      setFilterValue: state.setFilterValue,
      setRangeValue: state.setRangeValue,
      applyFilters: state.applyFilters,
      resetFilters: state.resetFilters,
      toggleCollapsed: state.toggleCollapsed,
      savePreset: state.savePreset,
      loadPreset: state.loadPreset,
      deletePreset: state.deletePreset,
    }))
  );

  const activeCount = useMemo(() => getActiveFilterCount(filterValues), [filterValues]);

  const fields = filterMode === 'adaptive' ? adaptiveFilterSchema : (filterSchema[activeTab] || []);

  const handleSavePreset = () => {
    const name = window.prompt('Preset name');
    if (!name) return;
    savePreset(name);
  };

  const handleApply = () => {
    applyFilters();
    onApply();
  };

  const handleReset = () => {
    resetFilters();
    onReset();
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Filters</h2>
          <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            {activeCount} active
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            value=""
            onChange={(event) => {
              const value = event.target.value;
              if (!value) return;
              if (value.startsWith('delete:')) {
                deletePreset(value.replace('delete:', ''));
                return;
              }
              loadPreset(value);
            }}
          >
            <option value="">My Presets</option>
            {presets.map((preset) => (
              <option key={preset.name} value={preset.name}>
                Load: {preset.name}
              </option>
            ))}
            {presets.map((preset) => (
              <option key={`delete-${preset.name}`} value={`delete:${preset.name}`}>
                Delete: {preset.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSavePreset}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Save Preset
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterMode('standard')}
              className={`rounded px-3 py-1.5 text-sm font-semibold ${filterMode === 'standard'
                ? 'bg-indigo-600 text-white'
                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
            >
              Standard Filters
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('adaptive')}
              className={`rounded px-3 py-1.5 text-sm font-semibold ${filterMode === 'adaptive'
                ? 'bg-indigo-600 text-white'
                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
            >
              Adaptive Filters
            </button>
          </div>

          {filterMode === 'standard' && (
            <div className="mb-4">
              <AdvancedFilterTabs tabs={filterTabs} activeTab={activeTab} onChange={setActiveTab} />
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {fields.map((field) => (
              <FilterField
                key={field.key}
                field={field}
                value={filterValues[field.key] as never}
                onSelectChange={setFilterValue}
                onRangeChange={setRangeValue}
              />
            ))}
          </div>
        </>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={handleReset}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={handleApply}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Apply Filters
        </button>
      </div>
    </section>
  );
}
