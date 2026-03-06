import { useEffect, useMemo, useState } from 'react';
import AdvancedFilterTabs from './AdvancedFilterTabs';
import FilterField from './FilterField';
import { adaptiveFilterSchema, filterSchema, filterTabs } from './filterSchema';
import { useAdvancedFilterStore } from '../../store/advancedFilterStore';
import { useShallow } from 'zustand/react/shallow';
import { apiJSON } from '../../config/api';

const FILTER_REGISTRY_KEY_BY_FIELD: Record<string, string> = {
  price: 'price',
  marketCap: 'market_cap',
  gapPercent: 'gap_percent',
  relativeVolume: 'relative_volume',
  atr: 'atr',
  atrPercent: 'atr',
  rsi14: 'rsi',
  sharesFloat: 'float',
  floatShares: 'float',
  sector: 'sector',
  country: 'country',
  vwapDistance: 'vwap',
  structureType: 'structure',
  minGrade: 'min_grade',
  adaptToSpy: 'spy_alignment',
};

const DEFAULT_FILTER_REGISTRY: string[] = [];
const ADAPTIVE_KEYS = adaptiveFilterSchema.map((field) => field.key);
const ADAPTIVE_KEYS_SET = new Set<string>(ADAPTIVE_KEYS as string[]);

const ADAPTIVE_GROUPS: Record<string, string> = {
  gapPercent: 'technical',
  rsi14: 'technical',
  structureType: 'technical',
  relativeVolume: 'volume',
  atrPercent: 'volume',
  vwapDistance: 'volume',
  floatShares: 'fundamental',
  minGrade: 'catalyst',
  adaptToSpy: 'earnings',
};

function formatChipValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'min' in (value as Record<string, unknown>) && 'max' in (value as Record<string, unknown>)) {
    const range = value as { min?: string; max?: string };
    const min = range.min || '-inf';
    const max = range.max || '+inf';
    return `${min} -> ${max}`;
  }
  return '';
}

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
  const [registryFilters, setRegistryFilters] = useState<string[]>(DEFAULT_FILTER_REGISTRY);
  const [adaptiveSearch, setAdaptiveSearch] = useState('');

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

  useEffect(() => {
    let canceled = false;

    async function loadFilterRegistry() {
      try {
        const payload = await apiJSON('/api/filters');
        const list = Array.isArray(payload?.filters) ? payload.filters : [];
        if (!canceled && list.length) {
          setRegistryFilters(list);
        }
      } catch {
      }
    }

    loadFilterRegistry();

    return () => {
      canceled = true;
    };
  }, []);

  // Start adaptive builder empty unless explicitly hydrated from URL.
  useEffect(() => {
    const hasAdaptiveQuery = ADAPTIVE_KEYS.some((key) => {
      const value = filterValues[key];
      if (!value) return false;
      if (typeof value === 'string') return Boolean(value);
      if (typeof value === 'object' && value !== null && 'min' in (value as Record<string, unknown>) && 'max' in (value as Record<string, unknown>)) {
        const range = value as { min?: string; max?: string };
        return Boolean(range.min || range.max);
      }
      return false;
    });

    if (hasAdaptiveQuery) return;

    ADAPTIVE_KEYS.forEach((key) => {
      setFilterValue(key, '');
      setRangeValue(key, { min: '', max: '' });
    });
  }, [setFilterValue, setRangeValue]);

  const fields = filterMode === 'adaptive' ? adaptiveFilterSchema : (filterSchema[activeTab] || []);

  const registrySet = useMemo(() => new Set(registryFilters), [registryFilters]);

  const visibleFields = useMemo(() => {
    return fields.filter((field) => {
      const registryKey = FILTER_REGISTRY_KEY_BY_FIELD[field.key];
      return registryKey ? registrySet.has(registryKey) : false;
    });
  }, [fields, registrySet]);

  const adaptiveVisibleFields = useMemo(() => {
    if (filterMode !== 'adaptive') return visibleFields;
    const needle = adaptiveSearch.trim().toLowerCase();
    if (!needle) return visibleFields;
    return visibleFields.filter((field) =>
      String(field.label || '').toLowerCase().includes(needle) ||
      String(field.key || '').toLowerCase().includes(needle)
    );
  }, [filterMode, visibleFields, adaptiveSearch]);

  const groupedAdaptiveFields = useMemo(() => {
    if (filterMode !== 'adaptive') return [] as Array<{ group: string; fields: typeof visibleFields }>;

    const groups = ['technical', 'volume', 'fundamental', 'catalyst', 'earnings'];
    return groups
      .map((group) => ({
        group,
        fields: adaptiveVisibleFields.filter((field) => (ADAPTIVE_GROUPS[field.key] || 'technical') === group),
      }))
      .filter((item) => item.fields.length > 0);
  }, [filterMode, adaptiveVisibleFields]);

  const activeFilterChips = useMemo(() => {
    const source = filterMode === 'adaptive'
      ? Object.fromEntries(Object.entries(filterValues).filter(([key]) => ADAPTIVE_KEYS_SET.has(key)))
      : filterValues;

    return Object.entries(source)
      .map(([key, value]) => {
        const label = [...adaptiveFilterSchema, ...Object.values(filterSchema).flat()].find((field) => field.key === key)?.label || key;
        const chipValue = formatChipValue(value);
        return chipValue ? { key, label, value: chipValue } : null;
      })
      .filter(Boolean) as Array<{ key: string; label: string; value: string }>;
  }, [filterMode, filterValues]);

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

  const removeFilterChip = (key: string) => {
    setFilterValue(key, '');
    setRangeValue(key, { min: '', max: '' });
    applyFilters();
    onApply();
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

          {filterMode === 'adaptive' && (
            <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                placeholder="Search adaptive filters..."
                value={adaptiveSearch}
                onChange={(event) => setAdaptiveSearch(event.target.value)}
              />
            </div>
          )}

          {activeFilterChips.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {activeFilterChips.map((chip) => (
                <button
                  key={`chip-${chip.key}`}
                  type="button"
                  onClick={() => removeFilterChip(chip.key)}
                  className="rounded-full border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  title="Remove filter"
                >
                  {chip.label} {chip.value} x
                </button>
              ))}
            </div>
          )}

          {filterMode === 'adaptive' ? (
            <div className="space-y-4">
              {groupedAdaptiveFields.map((bucket) => (
                <div key={bucket.group} className="space-y-2">
                  <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{bucket.group}</h4>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {bucket.fields.map((field) => (
                      <FilterField
                        key={field.key}
                        field={field as any}
                        value={filterValues[field.key] as never}
                        onSelectChange={setFilterValue}
                        onRangeChange={setRangeValue}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleFields.map((field) => (
                <FilterField
                  key={field.key}
                  field={field as any}
                  value={filterValues[field.key] as never}
                  onSelectChange={setFilterValue}
                  onRangeChange={setRangeValue}
                />
              ))}
            </div>
          )}
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
