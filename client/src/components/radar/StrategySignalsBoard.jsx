import Card from '../shared/Card';

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function StrategySignalsBoard({ rows = [], onSelectSymbol }) {
  const list = (Array.isArray(rows) ? rows : []).slice(0, 16);

  return (
    <Card>
      <h3 className="m-0 mb-3">Strategy Signals</h3>
      <div className="space-y-2">
        {list?.map((row, idx) => {
          const symbol = String(row?.symbol || '').toUpperCase();
          const accuracy = row?.accuracy || {};
          return (
            <div key={`${symbol}-${idx}`} className="rounded border border-[var(--border-default)] p-2 text-sm" style={{ background: 'var(--bg-elevated)' }}>
              <div className="flex items-center justify-between gap-2">
                <button type="button" className="font-semibold" style={{ color: 'var(--accent-blue)' }} onClick={() => onSelectSymbol?.(symbol)}>{symbol}</button>
                <span>{row?.strategy || '--'}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs muted">
                <span>Score {num(row?.score).toFixed(1)}</span>
                <span className="relative group inline-block">
                  breakdown
                  <span className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden w-56 rounded border border-[var(--border-default)] bg-[var(--bg-card)] p-2 text-left shadow-lg group-hover:block">
                    <div className="font-semibold">Score {num(row?.score).toFixed(0)}</div>
                    <div>Volume: {row?.score_breakdown?.volume_weight ?? '--'}</div>
                    <div>Gap: {row?.score_breakdown?.gap_weight ?? '--'}</div>
                    <div>Catalyst: {row?.score_breakdown?.catalyst_weight ?? '--'}</div>
                    <div>Trend: {row?.score_breakdown?.trend_weight ?? '--'}</div>
                    <div className="mt-1 border-t border-[var(--border-default)] pt-1">Win rate: {num(accuracy.win_rate).toFixed(1)}%</div>
                    <div>Average move: {num(accuracy.average_move).toFixed(2)}%</div>
                    <div>Failure rate: {num(accuracy.failure_rate).toFixed(1)}%</div>
                  </span>
                </span>
              </div>
            </div>
          );
        })}
        {!list.length ? <div className="muted text-sm">No strategy signal rows.</div> : null}
      </div>
    </Card>
  );
}
