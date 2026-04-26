"use client";

import { useState } from "react";

import { CongressionalFilters } from "@/components/congress/CongressionalFilters";
import { CongressionalTable } from "@/components/congress/CongressionalTable";
import type { CongressionalFilters as CongressionalFiltersState } from "@/components/congress/types";

const DEFAULT_FILTERS: CongressionalFiltersState = {
  chamber: "all",
  transactionType: "all",
  days: "30",
  highProfileOnly: false,
  symbol: "",
  member: "",
};

export default function CongressPage() {
  const [filters, setFilters] = useState<CongressionalFiltersState>(DEFAULT_FILTERS);

  return (
    <div className="flex flex-col gap-6 p-1 sm:p-2">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="w-fit rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
            Congressional Activity
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">Congressional Trades</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Recent House and Senate financial disclosures with member, ticker, amount, and filing context.
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-500">
          Source: <span className="text-slate-300">public disclosure filings</span>
        </div>
      </div>

      <CongressionalFilters filters={filters} onChange={setFilters} />
      <CongressionalTable filters={filters} />
    </div>
  );
}
