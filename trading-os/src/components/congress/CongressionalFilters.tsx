"use client";

import type {
  CongressionalChamberFilter,
  CongressionalDaysFilter,
  CongressionalFilters as CongressionalFiltersState,
  CongressionalTransactionFilter,
} from "@/components/congress/types";
import { cn } from "@/lib/utils";

type CongressionalFiltersProps = {
  filters: CongressionalFiltersState;
  onChange: (filters: CongressionalFiltersState) => void;
};

const CHAMBER_OPTIONS: Array<{ value: CongressionalChamberFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "senate", label: "Senate" },
  { value: "house", label: "House" },
];

const TRANSACTION_OPTIONS: Array<{ value: CongressionalTransactionFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "purchase", label: "Purchases" },
  { value: "sale", label: "Sales" },
];

const DAYS_OPTIONS: Array<{ value: CongressionalDaysFilter; label: string }> = [
  { value: "7", label: "7D" },
  { value: "14", label: "14D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "all", label: "All" },
];

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="flex rounded-lg border border-slate-800 bg-slate-950/50 p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition",
              value === option.value
                ? "bg-cyan-500/15 text-cyan-200 shadow-sm shadow-cyan-950/30"
                : "text-slate-500 hover:bg-slate-800/70 hover:text-slate-200"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CongressionalFilters({ filters, onChange }: CongressionalFiltersProps) {
  const update = (patch: Partial<CongressionalFiltersState>) => onChange({ ...filters, ...patch });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 shadow-sm shadow-black/20">
      <div className="grid gap-3 xl:grid-cols-[auto_auto_auto_auto_minmax(140px,1fr)_minmax(160px,1fr)] xl:items-end">
        <FilterGroup
          label="Chamber"
          value={filters.chamber}
          options={CHAMBER_OPTIONS}
          onSelect={(chamber) => update({ chamber })}
        />
        <FilterGroup
          label="Type"
          value={filters.transactionType}
          options={TRANSACTION_OPTIONS}
          onSelect={(transactionType) => update({ transactionType })}
        />
        <FilterGroup
          label="Lookback"
          value={filters.days}
          options={DAYS_OPTIONS}
          onSelect={(days) => update({ days })}
        />

        <label className="flex min-h-[54px] items-end gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs font-medium text-slate-300">
          <input
            type="checkbox"
            checked={filters.highProfileOnly}
            onChange={(event) => update({ highProfileOnly: event.target.checked })}
            className="size-4 rounded border-slate-700 bg-slate-950 text-cyan-400 focus:ring-cyan-500/40"
          />
          High-profile only
        </label>

        <label className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Symbol</span>
          <input
            value={filters.symbol}
            onChange={(event) => update({ symbol: event.target.value.toUpperCase() })}
            placeholder="MSFT"
            className="h-9 w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Member</span>
          <input
            value={filters.member}
            onChange={(event) => update({ member: event.target.value })}
            placeholder="Pelosi"
            className="h-9 w-full rounded-lg border border-slate-800 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10"
          />
        </label>
      </div>
    </div>
  );
}
