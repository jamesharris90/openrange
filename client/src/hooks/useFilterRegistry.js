import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../config/api';

const FALLBACK_FILTERS = [
  'price',
  'market_cap',
  'gap_percent',
  'relative_volume',
  'atr',
  'rsi',
  'float',
  'sector',
  'country',
  'vwap',
  'structure',
  'min_grade',
  'spy_alignment',
];

export function useFilterRegistry() {
  const [filters, setFilters] = useState(FALLBACK_FILTERS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let canceled = false;

    async function loadRegistry() {
      try {
        const payload = await apiJSON('/api/filters');
        const list = Array.isArray(payload?.filters) ? payload.filters : [];

        if (!canceled && list.length) {
          setFilters(list);
          setLoaded(true);
        } else if (!canceled) {
          setLoaded(false);
        }
      } catch {
        if (!canceled) {
          setLoaded(false);
        }
      }
    }

    loadRegistry();

    return () => {
      canceled = true;
    };
  }, []);

  const filterSet = useMemo(() => new Set(filters), [filters]);

  return {
    filters,
    filterSet,
    loaded,
  };
}
