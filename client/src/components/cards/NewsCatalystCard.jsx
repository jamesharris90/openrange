export default function NewsCatalystCard({ item }) {
  const confidence = Number(item.confidence ?? item.news_score ?? item.score ?? 0);
  const expectedMove = item.expected_move ?? item.expectedMove ?? '--';
  const catalystSummary = (
    item.catalyst_summary
    ?? (Array.isArray(item.catalyst_tags) ? item.catalyst_tags.join(', ') : '')
    ?? item.headline
    ?? 'No catalyst summary available.'
  );
  const sectorContext = item.sector_context ?? item.sector ?? '--';

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-100">{item.symbol || 'Market'}</h3>
      <p className="text-sm text-slate-200">{item.headline || item.title || 'No headline'}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
        <span>Confidence: <span className="text-green-400">{confidence.toFixed(1)}</span></span>
        <span>Expected Move: <span className="text-red-400">{expectedMove}</span></span>
        <span>Sector: {sectorContext}</span>
      </div>
      <p className="mt-2 text-xs text-slate-400">{catalystSummary}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
        <span>{item.catalyst_type || item.type || 'Catalyst'}</span>
        <span>•</span>
        <span className="text-blue-400">{item.sentiment || 'neutral'}</span>
      </div>
    </article>
  );
}
