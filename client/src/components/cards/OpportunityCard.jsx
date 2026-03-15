export default function OpportunityCard({ item }) {
  const confidence = Number(item.confidence ?? item.score ?? item.rank_score ?? 0);
  const expectedMove = item.expected_move ?? item.expectedMove ?? item.move_percent ?? '--';
  const catalystSummary = item.catalyst_summary ?? item.catalyst ?? item.reason ?? 'No catalyst summary available.';
  const sectorContext = item.sector_context ?? item.sector ?? '--';

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-100">{item.symbol || '--'}</h3>
        <span className="text-xs text-blue-400">Rank #{item.rank || '--'}</span>
      </div>
      <div className="text-sm text-slate-300">
        <p>Confidence: <span className="text-green-400">{confidence.toFixed(2)}</span></p>
        <p>Momentum: <span className="text-blue-400">{item.momentum || '--'}</span></p>
        <p>Expected Move: <span className="text-red-400">{expectedMove}</span></p>
        <p>Sector: {sectorContext}</p>
        <p>Setup: {item.strategy || item.setup || '--'}</p>
      </div>
      <p className="mt-2 text-xs text-slate-400">{catalystSummary}</p>
    </article>
  );
}
