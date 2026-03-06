import Card from '../shared/Card';

function regimeColor(regime) {
  const value = String(regime || '').toLowerCase();
  if (value.includes('bull')) return 'var(--accent-green)';
  if (value.includes('risk')) return 'var(--accent-red)';
  return 'var(--accent-amber)';
}

export default function MarketRegimeCard({ marketContext }) {
  const regime = marketContext?.regime || 'Neutral';
  const drivers = Array.isArray(marketContext?.drivers) ? marketContext.drivers : [];

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="m-0">Market Regime</h3>
        <span
          className="rounded px-2 py-1 text-xs"
          style={{
            color: regimeColor(regime),
            border: '1px solid var(--border-default)',
            background: 'color-mix(in srgb, var(--bg-elevated) 86%, #fff 14%)',
          }}
        >
          {regime}
        </span>
      </div>
      <div className="mt-3 space-y-2 text-sm">
        {drivers.length === 0 ? <div className="muted">Drivers unavailable.</div> : null}
        {drivers.map((driver, index) => (
          <div key={`${driver?.label || 'driver'}-${index}`} className="flex items-center justify-between rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
            <span className="muted">{driver?.label || 'Driver'}</span>
            <strong>{driver?.value || '--'}</strong>
          </div>
        ))}
      </div>
    </Card>
  );
}
