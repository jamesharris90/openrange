export default function RadarFilters({ filters, onChange }) {
  const update = (key, value) => onChange?.({ ...filters, [key]: value });

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs">
        Minimum Score
        <input
          type="number"
          value={filters.minScore}
          onChange={(event) => update('minScore', event.target.value)}
          className="mt-1 h-9 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2"
        />
      </label>
      <label className="text-xs">
        Gap %
        <input
          type="number"
          value={filters.minGap}
          onChange={(event) => update('minGap', event.target.value)}
          className="mt-1 h-9 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2"
        />
      </label>
      <label className="text-xs">
        Relative Volume
        <input
          type="number"
          step="0.1"
          value={filters.minRvol}
          onChange={(event) => update('minRvol', event.target.value)}
          className="mt-1 h-9 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2"
        />
      </label>
      <label className="text-xs">
        Market Cap (B)
        <input
          type="number"
          step="1"
          value={filters.minMarketCapB}
          onChange={(event) => update('minMarketCapB', event.target.value)}
          className="mt-1 h-9 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2"
        />
      </label>
    </div>
  );
}
