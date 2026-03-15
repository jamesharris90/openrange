export default function SectorMomentumCard({ sector }) {
  const score = Number(sector.score || sector.momentum || 0);
  const confidence = Number(sector.confidence ?? score ?? 0);
  const expectedMove = sector.expected_move ?? sector.expectedMove ?? '--';
  const catalystSummary = sector.catalyst_summary ?? sector.catalyst ?? 'No catalyst summary available.';
  const sectorContext = sector.sector_context ?? sector.name ?? sector.sector ?? '--';
  const width = Math.max(2, Math.min(100, Math.round(Math.abs(score) * 10)));
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">{sectorContext}</h3>
        <span className={score >= 0 ? 'text-green-400 text-xs' : 'text-red-400 text-xs'}>{score.toFixed(2)}</span>
      </div>
      <div className="h-2 rounded bg-slate-800">
        <div className={`h-2 rounded ${score >= 0 ? 'bg-green-400' : 'bg-red-400'}`} style={{ width: `${width}%` }} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
        <span>Confidence: <span className="text-green-400">{confidence.toFixed(1)}</span></span>
        <span>Expected Move: <span className="text-red-400">{expectedMove}</span></span>
      </div>
      <p className="mt-2 text-xs text-slate-400">Rotation: {sector.rotation || 'neutral'}</p>
      <p className="mt-1 text-xs text-slate-500">{catalystSummary}</p>
    </article>
  );
}
