export default function EarningsPanel({ rows = [], onSelectTicker }) {
  const items = rows.slice(0, 8);

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <h3 className="m-0 mb-3 text-sm font-semibold">Earnings</h3>
      <div className="space-y-2">
        {items.length === 0 ? <div className="text-xs text-[var(--text-muted)]">No upcoming earnings.</div> : null}
        {items.map((row, idx) => {
          const symbol = String(row?.symbol || '').toUpperCase();
          const session = Number(idx % 2) === 0 ? 'BMO' : 'AMC';
          const move = Number(row?.expected_move ?? row?.expected_move_percent ?? 0);
          return (
            <button key={`${symbol}-${idx}`} type="button" onClick={() => onSelectTicker?.(symbol)} className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-left text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{symbol || '--'}</span>
                <span className="text-[var(--text-muted)]">{session}</span>
              </div>
              <div className="text-[var(--text-muted)]">Expected move: {move ? `${move.toFixed(2)}%` : '--'}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
