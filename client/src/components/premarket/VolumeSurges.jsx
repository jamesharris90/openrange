export default function VolumeSurges({ rows = [], onSelectTicker }) {
  const top = [...rows]
    .sort((a, b) => Number(b?.relative_volume || 0) - Number(a?.relative_volume || 0))
    .slice(0, 6);

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <h3 className="m-0 mb-3 text-sm font-semibold">Volume Surges</h3>
      <div className="space-y-2">
        {top?.map((row) => {
          const symbol = String(row?.symbol || '').toUpperCase();
          const rvol = Number(row?.relative_volume || 0);
          const width = Math.max(8, Math.min(100, rvol * 20));
          return (
            <button key={symbol} type="button" onClick={() => onSelectTicker?.(symbol)} className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-left">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-semibold">{symbol}</span>
                <span>{rvol.toFixed(2)}x</span>
              </div>
              <div className="h-2 rounded bg-black/20">
                <div className="h-2 rounded bg-gradient-to-r from-amber-400 to-emerald-400" style={{ width: `${width}%`, transition: 'width 300ms ease' }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
