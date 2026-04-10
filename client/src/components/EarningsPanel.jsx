import React from 'react';

function pickArray(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function normalizeRows(earnings) {
  const rows = pickArray(earnings?.data, earnings?.items, earnings?.rows, earnings);
  return rows.slice(0, 5).map((row, index) => ({
    id: `${row?.symbol || 'earnings'}-${index}`,
    symbol: String(row?.symbol || row?.ticker || '--').toUpperCase(),
    time: String(row?.time || row?.report_time || row?.session || 'TBD').toUpperCase(),
  }));
}

export default function EarningsPanel({ earnings }) {
  const rows = normalizeRows(earnings);

  return (
    <section className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-4 shadow-[0_8px_24px_rgba(2,6,23,0.25)]">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">Earnings Today</h3>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-sm text-slate-400">No earnings events available.</p> : null}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between rounded-lg border border-slate-700/70 bg-slate-950/70 px-3 py-2">
            <span className="text-sm font-semibold text-slate-100">{row.symbol}</span>
            <span className="text-xs text-slate-300">{row.time}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
