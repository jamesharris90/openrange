function money(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '--';
  return `$${n.toFixed(2)}`;
}

export default function OpportunityBreakdown({ item, open, onClose }) {
  if (!open || !item) return null;

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">Opportunity Breakdown</h3>
        <button type="button" onClick={onClose} className="rounded border border-[var(--border-color)] px-2 py-1 text-xs">Close</button>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="mb-1 text-xs text-[var(--text-muted)]">WHY IS THIS MOVING?</div>
          <div>Catalyst: {item?.catalyst || 'No headline available.'}</div>
          <div>Source: {item?.news_source || 'Market feed'}</div>
          <div>Previous Day: {Number(item?.previous_day_move || 0).toFixed(2)}%</div>
        </div>

        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="mb-1 text-xs text-[var(--text-muted)]">WHY IS IT TRADEABLE?</div>
          <div>Relative Volume: {Number(item?.rvol || 0).toFixed(2)}x</div>
          <div>Float Size: {Number(item?.float_size || 0).toFixed(1)}M</div>
          <div>Sector Strength: {Number(item?.sector_strength || 0).toFixed(2)}%</div>
          <div>Strategy: {item?.strategy || 'Momentum Continuation'}</div>
        </div>

        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2">
          <div className="mb-1 text-xs text-[var(--text-muted)]">HOW SHOULD IT BE TRADED?</div>
          <div>Entry: {money(item?.entry)}</div>
          <div>Stop Loss: {money(item?.stop_loss)}</div>
          <div>Take Profit: {money(item?.take_profit)}</div>
          <div>Expected Move: {money(item?.expected_move)} ({Number(item?.expected_move_percent || 0).toFixed(2)}%)</div>
          <div>Volume Confirmation: RVOL above 1.5x on breakout candle.</div>
        </div>
      </div>
    </div>
  );
}
