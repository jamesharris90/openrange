import { create } from 'zustand';
import type { AdvancedFilterTab, FilterRangeValue, FilterValue } from '../components/screener/filterTypes';

type PresetRecord = {
  name: string;
  values: Record<string, FilterValue>;
  tab: AdvancedFilterTab;
};

type AdvancedFilterState = {
  activeTab: AdvancedFilterTab;
  collapsed: boolean;
  filterValues: Record<string, FilterValue>;
  appliedValues: Record<string, FilterValue>;
  applyNonce: number;
  presets: PresetRecord[];
  setActiveTab: (tab: AdvancedFilterTab) => void;
  setFilterValue: (key: string, value: string) => void;
  setRangeValue: (key: string, range: Partial<FilterRangeValue>) => void;
  applyFilters: () => void;
  resetFilters: () => void;
  toggleCollapsed: () => void;
  serializeToQueryString: () => string;
  hydrateFromQueryString: (queryString: string) => void;
  savePreset: (name: string) => void;
  loadPreset: (name: string) => void;
  deletePreset: (name: string) => void;
};

const PRESET_STORAGE_KEY = 'advanced-screener-presets-v2';
const VALID_TABS: AdvancedFilterTab[] = ['overview', 'valuation', 'financial', 'ownership', 'performance', 'technical', 'news', 'etf'];

function isRange(value: FilterValue | undefined): value is FilterRangeValue {
  return Boolean(value) && typeof value === 'object' && 'min' in (value as FilterRangeValue) && 'max' in (value as FilterRangeValue);
}

function readPresets(): PresetRecord[] {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePresets(presets: PresetRecord[]) {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // no-op
  }
}

function normalizeValues(values: Record<string, FilterValue>) {
  const next: Record<string, FilterValue> = {};

  Object.entries(values).forEach(([key, value]) => {
    if (isRange(value)) {
      const min = value.min ?? '';
      const max = value.max ?? '';
      if (!min && !max) return;
      next[key] = { min, max };
      return;
    }

    if (typeof value === 'string' && value) {
      next[key] = value;
    }
  });

  return next;
}

function valuesEqual(a: Record<string, FilterValue>, b: Record<string, FilterValue>) {
  const aNorm = normalizeValues(a);
  const bNorm = normalizeValues(b);
  return JSON.stringify(aNorm) === JSON.stringify(bNorm);
}

export const useAdvancedFilterStore = create<AdvancedFilterState>((set, get) => ({
  activeTab: 'overview',
  collapsed: false,
  filterValues: {},
  appliedValues: {},
  applyNonce: 0,
  presets: readPresets(),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setFilterValue: (key, value) => {
    set((state) => ({
      filterValues: {
        ...state.filterValues,
        [key]: value,
      },
    }));
  },

  setRangeValue: (key, range) => {
    set((state) => {
      const existing = state.filterValues[key];
      const baseRange: FilterRangeValue = isRange(existing)
        ? existing
        : { min: '', max: '' };

      return {
        filterValues: {
          ...state.filterValues,
          [key]: {
            min: range.min ?? baseRange.min,
            max: range.max ?? baseRange.max,
          },
        },
      };
    });
  },

  applyFilters: () => {
    set((state) => ({
      appliedValues: { ...state.filterValues },
      applyNonce: state.applyNonce + 1,
    }));
  },

  resetFilters: () => {
    set((state) => ({
      filterValues: {},
      appliedValues: {},
      applyNonce: state.applyNonce + 1,
    }));
  },

  toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),

  serializeToQueryString: () => {
    const state = get();
    const params = new URLSearchParams();
    params.set('tab', state.activeTab);

    Object.entries(state.filterValues).forEach(([key, value]) => {
      if (isRange(value)) {
        if (value.min) params.set(`${key}_min`, value.min);
        if (value.max) params.set(`${key}_max`, value.max);
      } else if (value) {
        params.set(key, value);
      }
    });

    return params.toString();
  },

  hydrateFromQueryString: (queryString) => {
    const query = queryString.startsWith('?') ? queryString.slice(1) : queryString;
    const params = new URLSearchParams(query);

    const values: Record<string, FilterValue> = {};
    const rangeMap: Record<string, FilterRangeValue> = {};

    params.forEach((value, key) => {
      if (key === 'tab') return;

      if (key.endsWith('_min')) {
        const rangeKey = key.replace(/_min$/, '');
        const current = rangeMap[rangeKey] || { min: '', max: '' };
        rangeMap[rangeKey] = { ...current, min: value };
        return;
      }

      if (key.endsWith('_max')) {
        const rangeKey = key.replace(/_max$/, '');
        const current = rangeMap[rangeKey] || { min: '', max: '' };
        rangeMap[rangeKey] = { ...current, max: value };
        return;
      }

      values[key] = value;
    });

    Object.entries(rangeMap).forEach(([k, v]) => {
      values[k] = v;
    });

    const tabParam = params.get('tab') as AdvancedFilterTab | null;
    const nextTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'overview';

    const normalizedValues = normalizeValues(values);

    const current = get();
    const noTabChange = current.activeTab === nextTab;
    const noValueChange = valuesEqual(current.filterValues, normalizedValues) && valuesEqual(current.appliedValues, normalizedValues);
    if (noTabChange && noValueChange) {
      return;
    }

    set((state) => ({
      activeTab: nextTab,
      filterValues: normalizedValues,
      appliedValues: { ...normalizedValues },
      applyNonce: state.applyNonce + 1,
    }));
  },

  savePreset: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    set((state) => {
      const nextPreset: PresetRecord = {
        name: trimmed,
        values: { ...state.filterValues },
        tab: state.activeTab,
      };

      const deduped = state.presets.filter((p) => p.name !== trimmed);
      const presets = [...deduped, nextPreset];
      writePresets(presets);
      return { presets };
    });
  },

  loadPreset: (name) => {
    const preset = get().presets.find((p) => p.name === name);
    if (!preset) return;

    set((state) => ({
      activeTab: preset.tab,
      filterValues: { ...preset.values },
      appliedValues: { ...preset.values },
      applyNonce: state.applyNonce + 1,
    }));
  },

  deletePreset: (name) => {
    set((state) => {
      const presets = state.presets.filter((p) => p.name !== name);
      writePresets(presets);
      return { presets };
    });
  },
}));
