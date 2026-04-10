import React from 'react';

function pickArray(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRows(sectors) {
  const rows = pickArray(sectors?.data, sectors?.items, sectors?.rows, sectors);
  return rows
    .map((row, index) => ({
      id: `${row?.sector || row?.name || row?.symbol || 'sector'}-${index}`,
      name: String(row?.sector || row?.name || row?.symbol || 'Unknown'),
      change: toNumber(row?.change_percent ?? row?.changePercent ?? row?.percent_change, 0),
    }))
    .sort((a, b) => b.change - a.change)
    .slice(0, 5);
}

export default function SectorPanel({ sectors }) {
  const rows = normalizeRows(sectors);

  return (
    <section className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-[0_8px_24px_rgba(2,6,23,0.25)]">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Sector Movers</h3>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-sm text-slate-400">No sector data available.</p> : null}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between rounded-lg border border-slate-700/70 bg-slate-950/70 px-3 py-2">
            <span className="text-sm text-slate-100">{row.name}</span>
            <span className={`text-xs font-semibold ${row.change >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {row.change >= 0 ? '+' : ''}{row.change.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
