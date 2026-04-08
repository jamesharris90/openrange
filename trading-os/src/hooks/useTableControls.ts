"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type FiltersUpdater<TFilters> = Partial<TFilters> | ((previous: TFilters) => TFilters);

type UseTableControlsOptions = {
  initialPage?: number;
  pageSize?: number;
};

export function useTableControls<TItem, TFilters extends Record<string, unknown>>(
  data: TItem[],
  initialFilters: TFilters,
  options: UseTableControlsOptions = {}
) {
  const { initialPage = 1, pageSize = 25 } = options;
  const initialFiltersRef = useRef(initialFilters);
  const [page, setPage] = useState(initialPage);
  const [filters, setFiltersState] = useState<TFilters>(initialFilters);

  const totalCount = data.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  const setFilters = useCallback((updater: FiltersUpdater<TFilters>) => {
    setPage(1);
    setFiltersState((previous) => {
      if (typeof updater === "function") {
        return (updater as (previous: TFilters) => TFilters)(previous);
      }

      return {
        ...previous,
        ...updater,
      };
    });
  }, []);

  const resetFilters = useCallback(() => {
    setPage(1);
    setFiltersState(initialFiltersRef.current);
  }, []);

  const paginatedData = useMemo(() => {
    const startIndex = (page - 1) * pageSize;
    return data.slice(startIndex, startIndex + pageSize);
  }, [data, page, pageSize]);

  return {
    page,
    pageSize,
    totalCount,
    totalPages,
    filters,
    setPage,
    setFilters,
    resetFilters,
    paginatedData,
  };
}