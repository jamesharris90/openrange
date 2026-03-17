"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { SignalTable } from "@/components/tables/signal-table";
import { Input } from "@/components/ui/input";
import { getStocksInPlay, type StocksFilters } from "@/lib/api/stocks";
import { QUERY_POLICY, queryKeys } from "@/lib/queries/policy";

export function StocksInPlayView() {
  const router = useRouter();
  const [filters, setFilters] = useState<StocksFilters>({ minPrice: 2, minRvol: 1.5, minGap: 0.5 });

  const { data = [] } = useQuery({
    queryKey: queryKeys.stocksInPlay(filters),
    queryFn: () => getStocksInPlay(filters),
    ...QUERY_POLICY.medium,
  });

  const sorted = useMemo(
    () => data.slice().sort((a, b) => b.probability - a.probability),
    [data]
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg md:grid-cols-4">
        <Input
          aria-label="Minimum price"
          value={filters.minPrice ?? ""}
          onChange={(event) => setFilters((prev) => ({ ...prev, minPrice: Number(event.target.value || 0) }))}
        />
        <Input
          aria-label="Minimum relative volume"
          value={filters.minRvol ?? ""}
          onChange={(event) => setFilters((prev) => ({ ...prev, minRvol: Number(event.target.value || 0) }))}
        />
        <Input
          aria-label="Minimum gap percent"
          value={filters.minGap ?? ""}
          onChange={(event) => setFilters((prev) => ({ ...prev, minGap: Number(event.target.value || 0) }))}
        />
        <Input
          aria-label="Sector"
          value={filters.sector ?? ""}
          onChange={(event) => setFilters((prev) => ({ ...prev, sector: event.target.value || undefined }))}
        />
      </div>

      <div onDoubleClick={() => sorted[0]?.symbol && router.push(`/trading-terminal?ticker=${sorted[0].symbol}`)}>
        <SignalTable rows={sorted} />
      </div>
    </div>
  );
}
