export default function SignalCard({ signal }) {
  const confidence = Number(signal.confidence ?? signal.score ?? signal.rank_score ?? 0);
  const probability = Number(signal.probability ?? signal.win_probability ?? 0);
  const expectedMove = signal.expected_move ?? signal.expectedMove ?? signal.move_percent ?? '--';
  const catalystSummary = signal.catalyst_summary ?? signal.catalyst ?? signal.reason ?? 'No catalyst summary available.';
  const sectorContext = signal.sector_context ?? signal.sector ?? signal.industry ?? '--';

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">{signal.symbol || '--'}</h3>
        <span className="rounded-full border border-blue-500/30 bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">{signal.setup || signal.strategy || 'Setup'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
        <div>Confidence: <span className="text-green-400">{confidence.toFixed(1)}</span></div>
        <div>Probability: <span className="text-blue-400">{probability.toFixed(1)}%</span></div>
        <div>Sector: {sectorContext}</div>
        <div>Expected Move: <span className="text-red-400">{expectedMove}</span></div>
      </div>
      <p className="mt-2 text-xs text-slate-400">{catalystSummary}</p>
    </article>
  );
}
