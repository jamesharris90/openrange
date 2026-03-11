import Card from '../shared/Card';

export default function MarketNarrativeCard({ narrative }) {
  const data = narrative || {};

  return (
    <Card>
      <h3 className="m-0 mb-2">Market Narrative</h3>
      <div className="text-sm font-semibold">{data?.headline || 'Narrative unavailable'}</div>
      <div className="mt-2 text-sm muted">{data?.analysis || 'No live narrative generated.'}</div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
          <div className="text-xs muted">Sector Implications</div>
          <div className="text-sm">{data?.sector_implications || '--'}</div>
        </div>
        <div className="rounded p-2" style={{ background: 'var(--bg-elevated)' }}>
          <div className="text-xs muted">Trade Implications</div>
          <div className="text-sm">{data?.trade_plan || '--'}</div>
        </div>
      </div>
      {Array.isArray(data?.tickers_to_watch) && data?.tickers_to_watch.length ? (
        <div className="mt-2 text-xs muted">Tickers to watch: {data?.tickers_to_watch.join(', ')}</div>
      ) : null}
    </Card>
  );
}
