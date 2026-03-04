import { useEffect, useMemo, useState } from 'react';
import { apiJSON } from '../config/api';

export function useFilterRegistry() {
  const [filters, setFilters] = useState([]);
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
