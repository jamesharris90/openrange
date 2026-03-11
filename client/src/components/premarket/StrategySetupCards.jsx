import Card from '../shared/Card';
import { formatPercent, toNumber } from './utils';

export default function StrategySetupCards({ setups = [], selectedSymbol, onSelectSymbol }) {
  const rows = (Array.isArray(setups) ? setups : []).slice(0, 12);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.length === 0 ? <div className="muted">No strategy setups available.</div> : null}
      {rows?.map((row, index) => {
        const symbol = String(row?.symbol || '').toUpperCase();
        const active = selectedSymbol === symbol;
        const idea = row?.trade_idea || (toNumber(row?.gap_percent, 0) >= 0
          ? 'ORB breakout above previous high'
          : 'VWAP reclaim entry');

        return (
          <Card
            key={`${symbol}-${index}`}
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
              <strong>{symbol || '--'}</strong>
              <span className="text-sm muted">Score {toNumber(row?.strategy_score, 0).toFixed(1)}</span>
            </div>
            <div className="mt-1 text-sm">{row?.setup_type || 'Momentum setup'}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
                <div className="muted text-xs">RVol</div>
                <div>{toNumber(row?.relative_volume, 0).toFixed(2)}x</div>
              </div>
              <div className="rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
                <div className="muted text-xs">Gap</div>
                <div>{formatPercent(row?.gap_percent)}</div>
              </div>
            </div>
            <div className="mt-2 rounded p-2 text-sm" style={{ background: 'var(--bg-elevated)' }}>
              <div className="muted text-xs">Trade Idea</div>
              <div>{idea}</div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
