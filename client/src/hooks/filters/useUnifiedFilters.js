import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UnifiedFiltersContext } from '../../context/filters/UnifiedFiltersContext';
import { parseUnifiedFiltersFromSearch, toLegacyQueryParams, writeUnifiedFiltersToSearch } from '../../lib/filters/querySync';

const DEFAULT_FILTERS = {
  marketCap: { min: '', max: '' },
  relativeVolume: { min: '', max: '' },
  price: { min: '', max: '' },
  sector: [],
  float: { min: '', max: '' },
  gapPercent: { min: '', max: '' },
  shortInterest: { min: '', max: '' },
  earningsProximity: { min: '', max: '' },
  newsCatalysts: [],
  institutionalOwnership: { min: '', max: '' },
};

export function useUnifiedFilters({ storageKey = 'openrange:unified-filters' } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [presets, setPresets] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch {
      return [];
    }
  });

  const parsed = useMemo(() => ({ ...DEFAULT_FILTERS, ...parseUnifiedFiltersFromSearch(searchParams) }), [searchParams]);

  const setFilters = useCallback((next) => {
    const nextValue = typeof next === 'function' ? next(parsed) : next;
    const params = writeUnifiedFiltersToSearch(nextValue);
    setSearchParams(params, { replace: true });
  }, [parsed, setSearchParams]);

  const updateRange = useCallback((key, range) => {
    setFilters((prev) => ({ ...prev, [key]: { ...prev[key], ...range } }));
  }, [setFilters]);

  const updateMulti = useCallback((key, values) => {
    setFilters((prev) => ({ ...prev, [key]: values }));
  }, [setFilters]);

  const clearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const savePreset = useCallback((name) => {
    const safeName = String(name || '').trim();
    if (!safeName) return;
    const next = [
      { id: crypto.randomUUID(), name: safeName, filters: parsed },
      ...presets.filter((item) => item.name !== safeName),
    ].slice(0, 20);
    setPresets(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }, [parsed, presets, storageKey]);

  const loadPreset = useCallback((id) => {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    setFilters(preset.filters);
  }, [presets, setFilters]);

  const deletePreset = useCallback((id) => {
    const next = presets.filter((item) => item.id !== id);
    setPresets(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }, [presets, storageKey]);

  return {
    filters: parsed,
    setFilters,
    updateRange,
    updateMulti,
    clearFilters,
    presets,
    savePreset,
    loadPreset,
    deletePreset,
    legacyQueryParams: toLegacyQueryParams(parsed),
  };
}

export function UnifiedFiltersProvider({ children, value }) {
  return React.createElement(UnifiedFiltersContext.Provider, { value }, children);
}
