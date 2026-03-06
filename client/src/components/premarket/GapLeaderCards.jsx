import Card from '../shared/Card';
import { formatPercent, toNumber } from './utils';

export default function GapLeaderCards({ leaders = [], selectedSymbol, onSelectSymbol }) {
  const rows = (Array.isArray(leaders) ? leaders : [])
    .filter((row) => toNumber(row?.gap_percent, 0) > 3 && toNumber(row?.relative_volume, 0) > 2)
    .sort((a, b) => toNumber(b?.gap_percent, 0) - toNumber(a?.gap_percent, 0))
    .slice(0, 12);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.length === 0 ? <div className="muted">No qualifying gap leaders.</div> : null}
      {rows.map((row) => {
        const symbol = String(row?.symbol || '').toUpperCase();
        const active = selectedSymbol === symbol;
        return (
          <Card
            key={symbol}
            role="button"
            tabIndex={0}
            onClick={() => onSelectSymbol?.(symbol)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectSymbol?.(symbol);
              }
            }}
            className="cursor-pointer"
            style={active ? { borderColor: 'var(--accent-blue)' } : undefined}
          >
            <div className="flex items-center justify-between">
              <strong>{symbol}</strong>
              <span style={{ color: 'var(--accent-green)' }}>{formatPercent(row?.gap_percent)}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
                <div className="muted text-xs">Relative Volume</div>
                <div>{toNumber(row?.relative_volume, 0).toFixed(2)}x</div>
              </div>
              <div className="rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
                <div className="muted text-xs">Float</div>
                <div>{toNumber(row?.float, 0).toLocaleString()}</div>
              </div>
            </div>
            <div className="mt-2 text-sm muted">{row?.catalyst || 'No catalyst provided.'}</div>
          </Card>
        );
      })}
    </div>
  );
}
