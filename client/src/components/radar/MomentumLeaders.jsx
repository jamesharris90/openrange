import Card from '../shared/Card';

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function format(value, digits = 2, suffix = '') {
  return `${num(value).toFixed(digits)}${suffix}`;
}

export default function MomentumLeaders({ rows = [], onSelectSymbol }) {
  const leaders = (Array.isArray(rows) ? rows : []).slice(0, 18);

  return (
    <Card>
      <h3 className="m-0 mb-3">Momentum Leaders</h3>
      <div className="overflow-auto">
        <table className="data-table data-table--compact min-w-[760px]">
          <thead>
            <tr>
              <th>Ticker</th>
              <th style={{ textAlign: 'right' }}>Current Price</th>
              <th style={{ textAlign: 'right' }}>Gap %</th>
              <th style={{ textAlign: 'right' }}>Relative Vol</th>
              <th style={{ textAlign: 'right' }}>Strategy Score</th>
            </tr>
          </thead>
          <tbody>
            {leaders.map((row) => (
              <tr key={String(row?.symbol || '')}>
                <td>
                  <button type="button" className="font-semibold" style={{ color: 'var(--accent-blue)' }} onClick={() => onSelectSymbol?.(String(row?.symbol || '').toUpperCase())}>
                    {String(row?.symbol || '').toUpperCase()}
                  </button>
                </td>
                <td style={{ textAlign: 'right' }}>{format(row?.price)}</td>
                <td style={{ textAlign: 'right' }}>{format(row?.gap_percent, 2, '%')}</td>
                <td style={{ textAlign: 'right' }}>{format(row?.relative_volume, 2)}</td>
                <td style={{ textAlign: 'right' }}>
                  <span className="relative group inline-block">
                    {format(row?.strategy_score ?? row?.score, 1)}
                    <span className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden w-48 rounded border border-[var(--border-default)] bg-[var(--bg-card)] p-2 text-left text-xs shadow-lg group-hover:block">
                      <div className="font-semibold">Score {format(row?.strategy_score ?? row?.score, 0)}</div>
                      <div>Volume: {row?.score_breakdown?.volume_weight ?? Math.min(40, Math.round(num(row?.relative_volume) * 12))}</div>
                      <div>Gap: {row?.score_breakdown?.gap_weight ?? Math.min(25, Math.round(Math.abs(num(row?.gap_percent)) * 3))}</div>
                      <div>Catalyst: {row?.score_breakdown?.catalyst_weight ?? (row?.catalyst ? 19 : 8)}</div>
                      <div>Trend: {row?.score_breakdown?.trend_weight ?? Math.min(15, Math.max(0, Math.round((num(row?.change_percent) + 2) * 3)))}</div>
                      <div className="mt-1 border-t border-[var(--border-default)] pt-1">Win rate: {num(row?.accuracy?.win_rate).toFixed(1)}%</div>
                      <div>Average move: {num(row?.accuracy?.average_move).toFixed(2)}%</div>
                      <div>Failure rate: {num(row?.accuracy?.failure_rate).toFixed(1)}%</div>
                    </span>
                  </span>
                </td>
              </tr>
            ))}
            {!leaders.length ? (
              <tr>
                <td colSpan={5} className="text-center text-xs muted">No momentum rows available.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
