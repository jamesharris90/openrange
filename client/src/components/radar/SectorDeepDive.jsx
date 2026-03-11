import Card from '../shared/Card';

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toneColor(value) {
  if (value > 0.3) return 'var(--accent-green)';
  if (value < -0.3) return 'var(--accent-red)';
  return 'var(--accent-amber)';
}

export default function SectorDeepDive({ sector, sectors = [], catalysts = [], onSelectSymbol }) {
  const data = (Array.isArray(sectors) ? sectors : []).find((row) => String(row?.sector || '') === sector) || null;
  const tickers = Array.isArray(data?.tickers) ? data?.tickers.slice(0, 8) : [];
  const topCatalyst = (Array.isArray(catalysts) ? catalysts : []).find((row) => {
    const text = `${row?.headline || ''} ${row?.catalyst_type || ''}`.toLowerCase();
    return text.includes(String(sector || '').toLowerCase());
  });

  if (!sector) {
    return (
      <Card>
        <h3 className="m-0">Sector Intelligence</h3>
        <div className="mt-2 text-sm muted">Click ticker tape or sector tags to inspect sector flow.</div>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="m-0">{sector}</h3>
      <div className="mt-1 text-sm muted">Sector heatmap and catalyst intelligence</div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {tickers.slice(0, 8)?.map((row) => (
          <button
            key={String(row?.symbol || '')}
            type="button"
            onClick={() => onSelectSymbol?.(String(row?.symbol || '').toUpperCase())}
            className="rounded p-2 text-left text-xs"
            style={{
              background: toneColor(num(row?.price_change) / 2),
              color: '#fff',
            }}
          >
            <div className="font-semibold">{String(row?.symbol || '').toUpperCase()}</div>
            <div>{num(row?.price_change).toFixed(2)}%</div>
          </button>
        ))}
      </div>

      <div className="mt-3">
        <div className="text-xs muted">Top movers</div>
        <div className="mt-1 flex flex-wrap gap-2 text-sm">
          {tickers.slice(0, 3)?.map((row) => (
            <button key={String(row?.symbol || '')} type="button" onClick={() => onSelectSymbol?.(String(row?.symbol || '').toUpperCase())} className="rounded border border-[var(--border-default)] px-2 py-1">
              {String(row?.symbol || '').toUpperCase()}
            </button>
          ))}
          {!tickers.length ? <span className="muted">No movers</span> : null}
        </div>
      </div>

      <div className="mt-3 rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
        <div className="text-xs muted">Sector catalyst</div>
        <div className="text-sm">{topCatalyst?.headline || 'No sector-specific catalyst headline found.'}</div>
      </div>
    </Card>
  );
}
