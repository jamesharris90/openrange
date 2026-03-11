import SparklineMini from '../charts/SparklineMini';
import Card from '../shared/Card';
import { formatPercent, toNumber } from './utils';

const DEFAULT_TARGETS = ['SPY', 'QQQ', 'IWM', 'VIX'];

export default function MarketContextCards({ cards = [], selectedSymbol, onSelectSymbol, targets = DEFAULT_TARGETS }) {
  const map = new Map((Array.isArray(cards) ? cards : [])?.map((row) => [String(row?.symbol || '').toUpperCase(), row]));

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {targets?.map((symbol) => {
        const row = map.get(symbol) || { symbol, price: 0, change_percent: 0, sparkline: [] };
        const change = toNumber(row.change_percent, 0);
        const bullish = change >= 0;
        const keyDrivers = Array.isArray(row?.key_drivers) ? row.key_drivers.slice(0, 3) : [];
        const sectorInfluence = row?.sector_influence || row?.sector || 'Macro Index';
        const composition = row?.etf_composition || row?.symbol || '--';

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
            className={`cursor-pointer ${selectedSymbol === symbol ? 'ring-1' : ''}`}
            style={selectedSymbol === symbol ? { borderColor: 'var(--accent-blue)' } : undefined}
          >
            <div className="group relative">
              <div className="flex items-center justify-between">
                <strong>{symbol}</strong>
                <span style={{ color: bullish ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  {formatPercent(change)}
                </span>
              </div>
              <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-56 rounded border border-[var(--border-default)] bg-[var(--bg-card)] p-2 text-xs shadow-lg group-hover:block">
                <div className="font-semibold">{symbol}</div>
                <div>Sector influence: {sectorInfluence}</div>
                <div>Composition: {composition}</div>
                <div className="mt-1 font-semibold">Key drivers</div>
                {keyDrivers.length ? keyDrivers?.map((driver, index) => (
                  <div key={`${driver?.symbol || symbol}-${index}`}>
                    {String(driver?.symbol || '').toUpperCase()} {Number(driver?.move || 0) >= 0 ? '+' : ''}{Number(driver?.move || 0).toFixed(2)}
                  </div>
                )) : <div>No driver detail available</div>}
              </span>
            </div>
            <div className="mt-1 text-sm muted">${toNumber(row.price, 0).toFixed(2)}</div>
            <div className="mt-2">
              <SparklineMini points={Array.isArray(row.sparkline) ? row.sparkline : []} positive={bullish} width={120} height={32} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
